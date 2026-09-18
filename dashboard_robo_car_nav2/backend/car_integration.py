"""Mașinuța: WebSocket și transformări; niciun publisher locomotor G1.

Protocolul și endpointurile mașinuței sunt extrase din backendul combinat.
Motorul G1 este furnizat numai prin snapshot-uri și calea hărții selectate.
"""
import asyncio
import json
import math
import os
import secrets
import threading
import time
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from feature_stiching import align_point_maps
from local_lidar_localization import _GridNearestNeighbor
from pcd_grid_map import PCDGridPlanner
from pcd_io import read_pcd
import numpy as np


def authorize_car(x_dashboard_token: str = Header(default=""), x_g1_token: str = Header(default="")):
    expected = os.environ.get("G1_DASHBOARD_TOKEN", "")
    if not expected or not secrets.compare_digest(x_dashboard_token or x_g1_token, expected):
        raise HTTPException(401, "Token dashboard invalid")


router = APIRouter()
g1_snapshot = lambda: {}
g1_map_path = lambda: None
pending_preview = None
g1_map_name = None


def set_g1_map(name):
    global g1_map_name, pending_preview
    if name != g1_map_name:
        g1_map_name = name
        pending_preview = None
        if car_alignment.get("status") == "aligned":
            car_alignment.update(status="idle", message="Harta G1 s-a schimbat; reconfirmă alinierea.")


def alignment_ready():
    return car_alignment.get("status") in {"manual", "aligned", "standalone", "direct"}


def configure(snapshot, map_path):
    global g1_snapshot, g1_map_path
    g1_snapshot, g1_map_path = snapshot, map_path


def _project_g1_pcd_for_car_alignment(map_path: str) -> List[tuple]:
    """Create/cache a floor-levelled 2D obstacle projection of the G1 PCD."""
    path = Path(map_path)
    target_file = path
    if path.parent.name == "maps_2d":
        candidate_3d = path.parent.parent / path.name
        if candidate_3d.is_file():
            target_file = candidate_3d

    resolved = os.path.realpath(str(target_file))
    modified = os.path.getmtime(resolved)
    with car_alignment_projection_lock:
        if (
            car_alignment_projection_cache["path"] == resolved
            and car_alignment_projection_cache["mtime"] == modified
            and car_alignment_projection_cache["points"]
        ):
            return list(car_alignment_projection_cache["points"])

    try:
        planner = PCDGridPlanner(
            resolution=0.08,
            robot_radius=0.10,
            min_obstacle_points=2,
            comfort_radius=0.10,
            clearance_weight=0.0,
            unknown_space_weight=0.0,
        )
        planner.load(
            resolved,
            obstacle_min_z=0.12,
            obstacle_max_z=1.85,
            level_to_floor=True,
            floor_tolerance=0.08,
        )
        points = [
            (cell_x * planner.resolution, cell_y * planner.resolution)
            for cell_x, cell_y in planner.raw_static_occupied
        ]
    except Exception:
        points_raw = read_pcd(Path(resolved))
        cells = {(round(float(p[0]) / .08), round(float(p[1]) / .08)) for p in points_raw}
        points = [(x * .08, y * .08) for x, y in cells]

    if len(points) < 20:
        raise ValueError("Proiecția 2D a PCD-ului nu conține suficiente obstacole")
    with car_alignment_projection_lock:
        car_alignment_projection_cache.update({
            "path": resolved,
            "mtime": modified,
            "points": points,
        })
    return list(points)


active_ws: List[WebSocket] = []



car_ws: Optional[WebSocket] = None



car_transform = {"x": 0.0, "y": 0.0, "yaw": 0.0}



car_alignment = {
    "status": "standalone",
    "message": "Mod direct mașinuță activ (coordonate native car_map).",
    "trigger": None,
    "updated_at": 0.0,
}



car_auto_align_task: Optional[asyncio.Task] = None



car_alignment_projection_cache = {
    "path": None,
    "mtime": None,
    "points": None,
}



car_alignment_projection_lock = threading.Lock()



car_state = {
    "connected": False,
    "last_seen": 0.0,
    "pose_updated_at": 0.0,
    "odom_pose": None,
    "map_pose": None,
    "scan_source_points": [],
    "scan_points": [],
    "scan_updated_at": 0.0,
    "scan_revision": 0,
    "path_source": [],
    "path": [],
    "path_topic": None,
    "path_updated_at": 0.0,
    "path_source_updated_at": 0.0,
    "path_point_count": 0,
    "path_revision": 0,
    "map_source_points": [],
    "map_points": [],
    "map_resolution": 0.0,
    "map_native_resolution": 0.0,
    "map_occupied_count": 0,
    "map_frame": None,
    "map_updated_at": 0.0,
    "map_revision": 0,
    "current_mode": "none",
    "mode_status": "stopped",
    "mode_details": "",
    "map_file": "/root/humble_ws/harta_masina_1.yaml",
    "slam_params_file": "/root/humble_ws/custom_params.yaml",
    "available_maps": [{"name": "harta_masina_1.yaml", "path": "/root/humble_ws/harta_masina_1.yaml"}],
}



async def broadcast(data: dict):
    msg = json.dumps(data)
    for ws in active_ws[:]:
        try: await ws.send_text(msg)
        except Exception:
            if ws in active_ws: active_ws.remove(ws)



def _normalize_yaw(value: float) -> float:
    return math.atan2(math.sin(value), math.cos(value))



def _yaw_from_quaternion(orientation: dict) -> float:
    x = float(orientation.get("x", 0.0))
    y = float(orientation.get("y", 0.0))
    z = float(orientation.get("z", 0.0))
    w = float(orientation.get("w", 1.0))
    return math.atan2(
        2.0 * (w * z + x * y),
        1.0 - 2.0 * (y * y + z * z),
    )



def _yaw_quaternion(yaw: float) -> dict:
    return {
        "x": 0.0, "y": 0.0,
        "z": math.sin(yaw / 2.0),
        "w": math.cos(yaw / 2.0),
    }



def _car_odom_pose_to_map(pose: dict) -> dict:
    """T_g1_map_car_map * pose_car_map, configured manually in the UI."""
    x = float(pose["x"])
    y = float(pose["y"])
    yaw = float(pose.get("yaw", 0.0))
    theta = car_transform["yaw"]
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    return {
        "x": car_transform["x"] + cos_t * x - sin_t * y,
        "y": car_transform["y"] + sin_t * x + cos_t * y,
        "yaw": _normalize_yaw(theta + yaw),
    }



def _car_map_pose_to_odom(pose: dict) -> dict:
    """Inverse T_g1_map_car_map, used for goals sent to the car map."""
    dx = float(pose["x"]) - car_transform["x"]
    dy = float(pose["y"]) - car_transform["y"]
    theta = car_transform["yaw"]
    cos_t, sin_t = math.cos(theta), math.sin(theta)
    return {
        "x": cos_t * dx + sin_t * dy,
        "y": -sin_t * dx + cos_t * dy,
        "yaw": _normalize_yaw(float(pose.get("yaw", 0.0)) - theta),
    }



def _car_public_state(
    include_scan: bool = True,
    include_path: bool = True,
    include_map: bool = True,
) -> dict:
    state = {
        "type": "car_state",
        "connected": car_state["connected"],
        "alignment_ready": alignment_ready(),
        "preview": pending_preview,
        "pose_age": time.time() - car_state["pose_updated_at"] if car_state["pose_updated_at"] else None,
        "last_seen": car_state["last_seen"],
        "pose": car_state["map_pose"],
        "car_map_pose": car_state["odom_pose"],
        # Backward-compatible alias retained for existing clients.
        "odom_pose": car_state["odom_pose"],
        "transform": {
            **car_transform,
            "yaw_deg": math.degrees(car_transform["yaw"]),
        },
        "alignment": dict(car_alignment),
        "current_mode": car_state.get("current_mode", "none"),
        "mode_status": car_state.get("mode_status", "stopped"),
        "mode_details": car_state.get("mode_details", ""),
        "map_file": car_state.get("map_file", "/root/humble_ws/harta_masina_1.yaml"),
        "slam_params_file": car_state.get("slam_params_file", "/root/humble_ws/custom_params.yaml"),
        "available_maps": car_state.get("available_maps", [{"name": "harta_masina_1.yaml", "path": "/root/humble_ws/harta_masina_1.yaml"}]),
    }
    if include_scan:
        state["scan_points"] = car_state["scan_points"]
    if include_path:
        state["path"] = car_state["path"]
        state["path_topic"] = car_state["path_topic"]
        state["path_updated_at"] = car_state["path_updated_at"]
        state["path_point_count"] = car_state["path_point_count"]
    if include_map:
        state["map_points"] = car_state["map_points"]
        state["map_resolution"] = car_state["map_resolution"]
        state["map_occupied_count"] = car_state["map_occupied_count"]
        state["map_frame"] = car_state["map_frame"]
    return state



def _car_source_points_to_g1_map(points: List[dict]) -> List[dict]:
    mapped_points = []
    for point in points:
        try:
            mapped = _car_odom_pose_to_map({
                "x": float(point["x"]),
                "y": float(point["y"]),
                "yaw": 0.0,
            })
        except (KeyError, TypeError, ValueError):
            continue
        if math.isfinite(mapped["x"]) and math.isfinite(mapped["y"]):
            mapped_points.append({"x": mapped["x"], "y": mapped["y"]})
    return mapped_points



def _refresh_car_spatial_layers() -> None:
    source_pose = car_state.get("odom_pose")
    car_state["map_pose"] = (
        _car_odom_pose_to_map(source_pose) if source_pose else None
    )
    car_state["scan_points"] = _car_source_points_to_g1_map(
        car_state.get("scan_source_points") or []
    )
    car_state["path"] = [
        _car_odom_pose_to_map(pose)
        for pose in (car_state.get("path_source") or [])
    ]
    car_state["map_points"] = _car_source_points_to_g1_map(
        car_state.get("map_source_points") or []
    )
    for revision_name in (
        "scan_revision",
        "path_revision",
        "map_revision",
    ):
        car_state[revision_name] = int(
            car_state.get(revision_name, 0)
        ) + 1



def _car_update_odom(data: dict) -> None:
    position = data.get("position") or {}
    orientation = data.get("orientation") or {}
    pose = {
        "x": float(position["x"]),
        "y": float(position["y"]),
        "yaw": _yaw_from_quaternion(orientation),
    }
    if not all(math.isfinite(value) for value in pose.values()):
        raise ValueError("odometrie nefinita")
    car_state["odom_pose"] = pose
    car_state["map_pose"] = _car_odom_pose_to_map(pose)
    car_state["pose_updated_at"] = time.time()



def _car_update_scan_points(data: dict) -> None:
    source_points = []
    for point in (data.get("points") or [])[:1200]:
        try:
            x = float(point["x"])
            y = float(point["y"])
        except (KeyError, TypeError, ValueError):
            continue
        if math.isfinite(x) and math.isfinite(y):
            source_points.append({"x": x, "y": y})
    car_state["scan_source_points"] = source_points
    car_state["scan_points"] = _car_source_points_to_g1_map(source_points)
    car_state["scan_updated_at"] = time.time()
    car_state["scan_revision"] = int(
        car_state.get("scan_revision", 0)
    ) + 1



def _car_update_scan(data: dict) -> None:
    """Compatibility path for older bridges that still send raw LaserScan."""
    odom_pose = car_state.get("odom_pose")
    ranges = data.get("ranges")
    if not odom_pose or not isinstance(ranges, list):
        return
    angle_min = float(data.get("angle_min", 0.0))
    angle_increment = float(data.get("angle_increment", 0.0))
    range_min = max(0.0, float(data.get("range_min", 0.0)))
    range_max = float(data.get("range_max", 100.0))
    step = max(1, math.ceil(len(ranges) / 1200))
    cos_pose, sin_pose = math.cos(odom_pose["yaw"]), math.sin(odom_pose["yaw"])
    source_points = []
    for index in range(0, len(ranges), step):
        distance = float(ranges[index])
        if not math.isfinite(distance) or distance < range_min or distance > range_max:
            continue
        angle = angle_min + index * angle_increment
        local_x = distance * math.cos(angle)
        local_y = distance * math.sin(angle)
        odom_x = odom_pose["x"] + cos_pose * local_x - sin_pose * local_y
        odom_y = odom_pose["y"] + sin_pose * local_x + cos_pose * local_y
        source_points.append({"x": odom_x, "y": odom_y})
    car_state["scan_source_points"] = source_points
    car_state["scan_points"] = _car_source_points_to_g1_map(source_points)
    car_state["scan_updated_at"] = time.time()
    car_state["scan_revision"] = int(
        car_state.get("scan_revision", 0)
    ) + 1



def _car_update_path(data: dict) -> None:
    poses = data.get("poses")
    if not isinstance(poses, list):
        return
    source_path = []
    step = max(1, math.ceil(len(poses) / 2000))
    for item in poses[::step]:
        try:
            position = item.get("position") or {}
            odom_pose = {
                "x": float(position["x"]),
                "y": float(position["y"]),
                "yaw": _yaw_from_quaternion(item.get("orientation") or {}),
            }
            source_path.append(odom_pose)
        except (KeyError, TypeError, ValueError):
            continue
    car_state["path_source"] = source_path
    car_state["path"] = [_car_odom_pose_to_map(pose) for pose in source_path]
    car_state["path_topic"] = str(data.get("source_topic") or "/path")
    car_state["path_source_updated_at"] = float(
        data.get("received_at") or 0.0
    )
    car_state["path_updated_at"] = time.time()
    car_state["path_point_count"] = len(source_path)
    car_state["path_revision"] = int(
        car_state.get("path_revision", 0)
    ) + 1



def _car_update_map(data: dict) -> None:
    """Update the car OccupancyGrid used for display and optional alignment."""
    width = int(data.get("width", 0))
    height = int(data.get("height", 0))
    resolution = float(data.get("resolution", 0.0))
    occupied_indices = data.get("occupied_indices")
    if (
        width <= 0 or height <= 0 or resolution <= 0.0
        or not isinstance(occupied_indices, list)
    ):
        raise ValueError("hartă OccupancyGrid invalidă")
    origin = data.get("origin") or {}
    origin_position = origin.get("position") or {}
    origin_orientation = origin.get("orientation") or {}
    origin_x = float(origin_position.get("x", 0.0))
    origin_y = float(origin_position.get("y", 0.0))
    origin_yaw = _yaw_from_quaternion(origin_orientation)
    cos_origin, sin_origin = math.cos(origin_yaw), math.sin(origin_yaw)
    # Keep map traffic/rendering bounded while retaining occupied-wall geometry.
    step = max(1, math.ceil(len(occupied_indices) / 60000))
    source_points = []
    for raw_index in occupied_indices[::step]:
        try:
            index = int(raw_index)
        except (TypeError, ValueError):
            continue
        if index < 0 or index >= width * height:
            continue
        row, column = divmod(index, width)
        local_x = (column + 0.5) * resolution
        local_y = (row + 0.5) * resolution
        source_points.append({
            "x": origin_x + cos_origin * local_x - sin_origin * local_y,
            "y": origin_y + sin_origin * local_x + cos_origin * local_y,
        })
    car_state["map_source_points"] = source_points
    car_state["map_points"] = _car_source_points_to_g1_map(source_points)
    car_state["map_resolution"] = resolution * step
    car_state["map_native_resolution"] = resolution
    car_state["map_occupied_count"] = len(occupied_indices)
    car_state["map_frame"] = str(data.get("frame_id") or "map")
    car_state["map_updated_at"] = time.time()
    car_state["map_revision"] = int(
        car_state.get("map_revision", 0)
    ) + 1



def _compute_car_map_alignment(
    map_path: str, source_points: List[dict], resolution: float
) -> dict:
    target_points = _project_g1_pcd_for_car_alignment(map_path)
    return align_point_maps(
        target_points,
        source_points,
        resolution=max(0.05, min(0.12, float(resolution or 0.08))),
    )



def refine_alignment_icp(
    target_points: List[tuple],
    source_points: List[dict],
    init_x: float,
    init_y: float,
    init_yaw: float,
) -> dict:
    """Rafinează robust transformarea car_map -> G1 map folosind ICP 2D."""
    target_xy = np.asarray(target_points, dtype=np.float64).reshape((-1, 2))
    source_xy = np.asarray([[float(p["x"]), float(p["y"])] for p in source_points], dtype=np.float64).reshape((-1, 2))
    if len(target_xy) < 20 or len(source_xy) < 10:
        raise ValueError("Puncte insuficiente pentru alinierea ICP")

    step = max(1, len(source_xy) // 1500)
    sampled_src = source_xy[::step]
    grid = _GridNearestNeighbor(target_xy, cell_size=0.60)

    def _icp_pass(sx: float, sy: float, syaw: float, max_iters: int = 25):
        cur_x, cur_y, cur_yaw = sx, sy, syaw
        best_rmse = float("inf")
        inliers = 0
        for i in range(max_iters):
            c_y, s_y = math.cos(cur_yaw), math.sin(cur_yaw)
            trans_src = np.column_stack([
                cur_x + c_y * sampled_src[:, 0] - s_y * sampled_src[:, 1],
                cur_y + s_y * sampled_src[:, 0] + c_y * sampled_src[:, 1],
            ])
            progress = i / float(max_iters)
            d_max = 1.60 * (1.0 - progress) + 0.30 * progress
            dists, idxs = grid.query(trans_src)
            mask = dists < d_max
            inliers = int(np.count_nonzero(mask))
            if inliers < 15:
                break
            pts_s = trans_src[mask]
            pts_t = target_xy[idxs[mask]]
            mean_s = np.mean(pts_s, axis=0)
            mean_t = np.mean(pts_t, axis=0)
            H = (pts_s - mean_s).T @ (pts_t - mean_t)
            U, _, Vt = np.linalg.svd(H)
            R = Vt.T @ U.T
            if np.linalg.det(R) < 0:
                Vt[-1, :] *= -1
                R = Vt.T @ U.T
            d_yaw = math.atan2(R[1, 0], R[0, 0])
            d_tr = mean_t - R @ mean_s
            cur_rot = np.array([[math.cos(cur_yaw), -math.sin(cur_yaw)], [math.sin(cur_yaw), math.cos(cur_yaw)]])
            new_rot = R @ cur_rot
            cur_yaw = math.atan2(new_rot[1, 0], new_rot[0, 0])
            new_tr = R @ np.array([cur_x, cur_y]) + d_tr
            cur_x, cur_y = float(new_tr[0]), float(new_tr[1])
            best_rmse = float(np.sqrt(np.mean(dists[mask] ** 2)))
            if abs(d_yaw) < 1e-4 and np.linalg.norm(d_tr) < 1e-3:
                break
        overlap = inliers / float(len(sampled_src))
        return cur_x, cur_y, cur_yaw, best_rmse, overlap

    best = None
    for dyaw_deg in (-30, -20, -10, 0, 10, 20, 30):
        cand_yaw = init_yaw + math.radians(dyaw_deg)
        rx, ry, ryaw, rmse, overlap = _icp_pass(init_x, init_y, cand_yaw)
        score = overlap * (1.0 - min(1.0, rmse / 0.50))
        if best is None or score > best["score"]:
            best = {
                "x": rx, "y": ry, "yaw": ryaw,
                "yaw_deg": math.degrees(ryaw),
                "rmse_m": rmse,
                "overlap": float(overlap),
                "score": score,
            }

    if best is None or best["overlap"] < 0.20:
        raise ValueError("ICP nu a putut alinia pereții (suprapunere insuficientă)")

    return best



async def _run_car_auto_alignment(trigger: str = "manual") -> dict:
    """Estimate and, only if validated, apply car_map -> G1 map."""
    map_path = g1_map_path()
    source_points = list(car_state.get("map_source_points") or [])
    if not map_path:
        error = "Încarcă mai întâi harta PCD a robotului G1."
        car_alignment.update({
            "status": "waiting", "message": error,
            "trigger": trigger, "updated_at": time.time(),
        })
        return {"success": False, "error": error, **_car_public_state()}
    if len(source_points) < 20:
        error = "Aștept o hartă /map cu suficiente celule ocupate de la mașină."
        car_alignment.update({
            "status": "waiting", "message": error,
            "trigger": trigger, "updated_at": time.time(),
        })
        return {"success": False, "error": error, **_car_public_state()}

    car_alignment.clear()
    car_alignment.update({
        "status": "running",
        "message": "Proiectez PCD-ul și caut trăsături comune…",
        "trigger": trigger,
        "updated_at": time.time(),
    })
    await broadcast(_car_public_state(False, False, False))
    try:
        result = await asyncio.to_thread(
            _compute_car_map_alignment,
            map_path,
            source_points,
            car_state.get("map_native_resolution") or 0.08,
        )
        if not result.get("accepted"):
            raise ValueError(
                "Potrivire nesigură: "
                f"matches={result.get('matches', 0)}, "
                f"overlap={100.0 * result.get('overlap', 0.0):.1f}%, "
                f"RMSE={result.get('rmse_m', 0.0):.2f} m"
            )
        car_transform.update({
            "x": float(result["x"]),
            "y": float(result["y"]),
            "yaw": float(result["yaw"]),
        })
        _refresh_car_spatial_layers()
        car_alignment.clear()
        method_str = "geometrică 2D" if result.get("method") == "geometric_2d" else "trăsături vizuale"
        car_alignment.update({
            "status": "aligned",
            "message": f"Hărțile au fost potrivite ({method_str}, RMSE={result.get('rmse_m', 0.0):.2f} m, overlap={100.0 * result.get('overlap', 0.0):.1f}%).",
            "trigger": trigger,
            "updated_at": time.time(),
            **result,
        })
        public_state = _car_public_state()
        await broadcast(public_state)
        return {"success": True, **public_state}
    except Exception as exc:
        diagnostics = result if "result" in locals() else {}
        car_alignment.clear()
        car_alignment.update({
            "status": "failed",
            "message": str(exc),
            "trigger": trigger,
            "updated_at": time.time(),
            **diagnostics,
        })
        public_state = _car_public_state(False, False, False)
        await broadcast(public_state)
        return {"success": False, "error": str(exc), **public_state}



@router.websocket("/ws/car")
async def car_websocket_endpoint(ws: WebSocket):
    """Canal dedicat bridge-ului ROS 2 al mașinii, fără autentificare."""
    global car_ws, pending_preview
    await ws.accept()
    previous = car_ws
    car_ws = ws
    pending_preview = None
    if previous is not None and previous is not ws:
        try:
            await previous.close(code=1012, reason="Car bridge replaced")
        except Exception:
            pass
    car_state["connected"] = True
    car_state["last_seen"] = time.time()
    await broadcast(_car_public_state())
    try:
        while True:
            raw = await ws.receive_text()
            try:
                message = json.loads(raw)
                topic = message.get("topic")
                data = message.get("data") or {}
                if topic == "/scan_odom":
                    _car_update_odom(data)
                    public_state = _car_public_state(False, False, False)
                elif topic == "/scan_points":
                    _car_update_scan_points(data)
                    public_state = _car_public_state(True, False, False)
                elif topic == "/scan":
                    _car_update_scan(data)
                    public_state = _car_public_state(True, False, False)
                elif topic == "/path":
                    _car_update_path(data)
                    public_state = _car_public_state(False, True, False)
                elif topic == "/map":
                    _car_update_map(data)
                    public_state = _car_public_state(False, False, True)
                elif topic == "/path_status":
                    if pending_preview and data.get("request_id") == pending_preview["request_id"]:
                        pending_preview["ready"] = data.get("status") == "ready" and int(data.get("points", 0)) > 0
                    public_state = {"type": "car_path_status", **data}
                elif topic == "/initial_pose_status":
                    public_state = {"type": "car_initial_pose_status", **data}
                elif topic == "/mode_status":
                    car_state["current_mode"] = data.get("current_mode", "none")
                    car_state["mode_status"] = data.get("status") or data.get("mode_status", "stopped")
                    car_state["mode_details"] = data.get("details", "")
                    public_state = {
                        "type": "car_mode_status",
                        "current_mode": car_state["current_mode"],
                        "mode_status": car_state["mode_status"],
                        "details": car_state["mode_details"],
                    }
                elif topic == "/car_maps_list":
                    car_state["available_maps"] = data.get("maps", [])
                    public_state = {
                        "type": "car_maps_list",
                        "maps": car_state["available_maps"],
                    }
                elif topic == "/save_map_status":
                    public_state = {
                        "type": "car_save_map_status",
                        **data,
                    }
                else:
                    continue
                car_state["last_seen"] = time.time()
                public_state["last_seen"] = car_state["last_seen"]
                await broadcast(public_state)
            except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
                print(f"[car] mesaj invalid: {exc}")
    except WebSocketDisconnect:
        pass
    finally:
        if car_ws is ws:
            car_ws = None
            pending_preview = None
            car_state["connected"] = False
            await broadcast(_car_public_state())



@router.get("/api/car/status", dependencies=[Depends(authorize_car)])
async def get_car_status(include_layers: bool = True):
    return {"success": True, **_car_public_state(include_layers, include_layers, include_layers)}



@router.post("/api/car/transform", dependencies=[Depends(authorize_car)])
async def set_car_transform(request: Request):
    global pending_preview
    body = await request.json()
    try:
        values = {
            "x": float(body["x"]),
            "y": float(body["y"]),
            "yaw": math.radians(float(body.get("yaw_deg", 0.0))),
        }
    except (KeyError, TypeError, ValueError):
        return JSONResponse(
            {"success": False, "error": "Transformare invalidă"},
            status_code=400,
        )
    if not all(math.isfinite(value) for value in values.values()):
        return JSONResponse(
            {"success": False, "error": "Transformarea trebuie să fie finită"},
            status_code=400,
        )
    car_transform.update(values)
    pending_preview = None
    _refresh_car_spatial_layers()
    car_alignment.clear()
    car_alignment.update({
        "status": "manual",
        "message": "Transformarea manuală este activă.",
        "trigger": "manual_transform",
        "updated_at": time.time(),
    })
    public_state = _car_public_state()
    await broadcast(public_state)
    return {"success": True, **public_state}



@router.post("/api/car/refine_icp", dependencies=[Depends(authorize_car)])
async def refine_car_alignment_icp(request: Request):
    """Rafinează alinierea car_map -> G1 map pornind de la o poziție inițială / click folosind ICP."""
    global pending_preview
    map_path = g1_map_path()
    source_points = list(car_state.get("map_source_points") or [])
    if not map_path:
        return JSONResponse({"success": False, "error": "Încarcă mai întâi harta PCD a robotului G1."}, status_code=400)
    if len(source_points) < 20:
        return JSONResponse({"success": False, "error": "Aștept o hartă /map cu suficiente celule de la mașină."}, status_code=400)

    try:
        body = await request.json()
        init_x = float(body.get("x", car_transform["x"]))
        init_y = float(body.get("y", car_transform["y"]))
        init_yaw = math.radians(float(body.get("yaw_deg", math.degrees(car_transform["yaw"]))))
    except Exception:
        init_x = float(car_transform["x"])
        init_y = float(car_transform["y"])
        init_yaw = float(car_transform["yaw"])

    try:
        target_points = await asyncio.to_thread(_project_g1_pcd_for_car_alignment, map_path)
        refined = await asyncio.to_thread(
            refine_alignment_icp,
            target_points,
            source_points,
            init_x,
            init_y,
            init_yaw,
        )
        car_transform.update({
            "x": float(refined["x"]),
            "y": float(refined["y"]),
            "yaw": float(refined["yaw"]),
        })
        pending_preview = None
        _refresh_car_spatial_layers()
        car_alignment.clear()
        car_alignment.update({
            "status": "aligned",
            "message": f"Pereți aliniați precis prin ICP (RMSE={refined['rmse_m']:.2f} m, overlap={100.0 * refined['overlap']:.1f}%).",
            "trigger": "icp_refine",
            "updated_at": time.time(),
            **refined,
        })
        public_state = _car_public_state()
        await broadcast(public_state)
        return {"success": True, **public_state}
    except Exception as exc:
        return JSONResponse({"success": False, "error": f"Rafinarea ICP a eșuat: {exc}"}, status_code=422)



@router.post("/api/car/standalone", dependencies=[Depends(authorize_car)])
async def set_car_standalone_mode():
    """Activează modul direct / independent pentru mașinuță (fără aliniere G1)."""
    car_transform.update({"x": 0.0, "y": 0.0, "yaw": 0.0})
    global pending_preview
    pending_preview = None
    _refresh_car_spatial_layers()
    car_alignment.clear()
    car_alignment.update({
        "status": "standalone",
        "message": "Mod direct mașinuță activ (coordonate native car_map).",
        "trigger": "operator_standalone",
        "updated_at": time.time(),
    })
    public_state = _car_public_state()
    await broadcast(public_state)
    return {"success": True, **public_state}



@router.post("/api/car/auto_align", dependencies=[Depends(authorize_car)])
async def auto_align_car_maps():
    global car_auto_align_task, pending_preview
    pending_preview = None
    if car_auto_align_task is not None and not car_auto_align_task.done():
        return JSONResponse(
            {
                "success": False,
                "error": "Potrivirea hărților rulează deja.",
                **_car_public_state(False, False, False),
            },
            status_code=409,
        )
    car_auto_align_task = asyncio.create_task(
        _run_car_auto_alignment("operator_retry")
    )
    result = await car_auto_align_task
    if not result.get("success"):
        return JSONResponse(result, status_code=422)
    return result



@router.post("/api/car/goal", dependencies=[Depends(authorize_car)])
async def send_car_goal(request: Request):
    global pending_preview
    if car_ws is None or not car_state["connected"]:
        return JSONResponse(
            {"success": False, "error": "Mașina nu este conectată"},
            status_code=409,
        )
    body = await request.json()
    if not alignment_ready():
        car_alignment.update(
            status="standalone",
            message="Mod direct mașinuță activ (fără aliniere G1).",
            updated_at=time.time(),
        )
        car_transform.update({"x": 0.0, "y": 0.0, "yaw": 0.0})
        _refresh_car_spatial_layers()
    try:
        map_goal = {
            "x": float(body["x"]),
            "y": float(body["y"]),
            "yaw": math.radians(float(body.get("yaw_deg", 0.0))),
        }
    except (KeyError, TypeError, ValueError):
        return JSONResponse(
            {"success": False, "error": "Țintă invalidă"},
            status_code=400,
        )
    if not all(math.isfinite(value) for value in map_goal.values()):
        return JSONResponse(
            {"success": False, "error": "Ținta trebuie să fie finită"},
            status_code=400,
        )
    preview = pending_preview
    if preview and body.get("preview_id") == preview.get("request_id"):
        pending_preview = None
    odom_goal = _car_map_pose_to_odom(map_goal)
    payload = {
        "type": "goal_pose",
        "request_id": secrets.token_urlsafe(8),
        "position": {"x": odom_goal["x"], "y": odom_goal["y"], "z": 0.0},
        "orientation": _yaw_quaternion(odom_goal["yaw"]),
    }
    try:
        await car_ws.send_text(json.dumps(payload))
    except Exception as exc:
        return JSONResponse(
            {"success": False, "error": f"Trimiterea țintei a eșuat: {exc}"},
            status_code=503,
        )
    await broadcast({
        "type": "car_goal",
        "map_goal": map_goal,
        "car_map_goal": odom_goal,
        "odom_goal": odom_goal,
    })
    return {
        "success": True,
        "map_goal": map_goal,
        "car_map_goal": odom_goal,
        "odom_goal": odom_goal,
    }



@router.post("/api/car/initial_pose", dependencies=[Depends(authorize_car)])
async def set_car_initial_pose(request: Request):
    """Publish a dashboard-map pose estimate into the car's AMCL map frame."""
    if car_ws is None or not car_state["connected"]:
        return JSONResponse(
            {"success": False, "error": "Mașina nu este conectată"},
            status_code=409,
        )
    body = await request.json()
    if not alignment_ready():
        car_alignment.update(
            status="standalone",
            message="Mod direct mașinuță activ (fără aliniere G1).",
            updated_at=time.time(),
        )
        car_transform.update({"x": 0.0, "y": 0.0, "yaw": 0.0})
        _refresh_car_spatial_layers()
    try:
        dashboard_pose = {
            "x": float(body["x"]),
            "y": float(body["y"]),
            "yaw": math.radians(float(body.get("yaw_deg", 0.0))),
        }
    except (KeyError, TypeError, ValueError):
        return JSONResponse(
            {"success": False, "error": "Poziție inițială invalidă"},
            status_code=400,
        )
    if not all(math.isfinite(value) for value in dashboard_pose.values()):
        return JSONResponse(
            {"success": False, "error": "Poziția trebuie să fie finită"},
            status_code=400,
        )
    car_map_pose = _car_map_pose_to_odom(dashboard_pose)
    request_id = secrets.token_urlsafe(8)
    payload = {
        "type": "initial_pose",
        "request_id": request_id,
        "position": {
            "x": car_map_pose["x"], "y": car_map_pose["y"], "z": 0.0,
        },
        "orientation": _yaw_quaternion(car_map_pose["yaw"]),
    }
    try:
        await car_ws.send_text(json.dumps(payload))
    except Exception as exc:
        return JSONResponse(
            {"success": False, "error": f"Trimiterea poziției a eșuat: {exc}"},
            status_code=503,
        )
    await broadcast({
        "type": "car_initial_pose",
        "request_id": request_id,
        "map_pose": dashboard_pose,
        "car_map_pose": car_map_pose,
    })
    return {
        "success": True,
        "request_id": request_id,
        "map_pose": dashboard_pose,
        "car_map_pose": car_map_pose,
    }



@router.post("/api/car/mode", dependencies=[Depends(authorize_car)])
async def set_car_mode(request: Request):
    global pending_preview
    pending_preview = None
    """Switch the car's navigation mode: 'mapping' (SLAM Toolbox) vs 'localization' (AMCL) vs 'stop'."""
    if car_ws is None or not car_state["connected"]:
        return JSONResponse(
            {"success": False, "error": "Mașina nu este conectată la dashboard"},
            status_code=409,
        )
    body = await request.json()
    mode = str(body.get("mode", "stop")).lower().strip()
    if mode not in {"mapping", "localization", "stop", "none", "off"}:
        return JSONResponse(
            {"success": False, "error": f"Mod invalid '{mode}'. Folosește 'mapping', 'localization' sau 'stop'."},
            status_code=400,
        )
    map_file = body.get("map_file") or car_state.get("map_file", "/root/humble_ws/harta_masina_1.yaml")
    slam_params_file = body.get("slam_params_file") or car_state.get("slam_params_file", "/root/humble_ws/custom_params.yaml")
    params_file = body.get("params_file") or "/root/humble_ws/src/lab1/params/nav2_car_params.yaml"

    car_state["map_file"] = map_file
    car_state["slam_params_file"] = slam_params_file
    car_state["current_mode"] = "none" if mode in ("stop", "none", "off") else mode
    car_state["mode_status"] = "switching"
    car_state["mode_details"] = f"Comandă trimisă: {mode}"

    payload = {
        "type": "car_mode",
        "mode": mode,
        "map_file": map_file,
        "slam_params_file": slam_params_file,
        "params_file": params_file,
    }
    try:
        await car_ws.send_text(json.dumps(payload))
    except Exception as exc:
        return JSONResponse(
            {"success": False, "error": f"Trimiterea comenzii de mod a eșuat: {exc}"},
            status_code=503,
        )
    await broadcast(_car_public_state())
    return {
        "success": True,
        "mode": mode,
        "map_file": map_file,
        "slam_params_file": slam_params_file,
        **_car_public_state(),
    }



@router.get("/api/car/mode", dependencies=[Depends(authorize_car)])
async def get_car_mode():
    return {
        "success": True,
        "current_mode": car_state.get("current_mode", "none"),
        "mode_status": car_state.get("mode_status", "stopped"),
        "mode_details": car_state.get("mode_details", ""),
        "map_file": car_state.get("map_file", "/root/humble_ws/harta_masina_1.yaml"),
        "slam_params_file": car_state.get("slam_params_file", "/root/humble_ws/custom_params.yaml"),
        "available_maps": car_state.get("available_maps", []),
    }



@router.get("/api/car/maps", dependencies=[Depends(authorize_car)])
async def get_car_maps():
    return {"success": True, "maps": car_state.get("available_maps", [])}



@router.post("/api/car/maps/refresh", dependencies=[Depends(authorize_car)])
async def refresh_car_maps():
    if car_ws is not None and car_state["connected"]:
        try:
            await car_ws.send_text(json.dumps({"type": "list_maps"}))
        except Exception:
            pass
    return {"success": True, "maps": car_state.get("available_maps", [])}



@router.post("/api/car/map/save", dependencies=[Depends(authorize_car)])
async def save_car_map_endpoint(request: Request):
    """Trigger map saving on the car via WebSocket."""
    if car_ws is None or not car_state["connected"]:
        return JSONResponse(
            {"success": False, "error": "Mașina nu este conectată la dashboard"},
            status_code=409,
        )
    body = await request.json()
    map_name = str(body.get("map_name", "")).strip()
    if not map_name:
        map_name = f"harta_masina_{int(time.time())}"
    payload = {
        "type": "save_map",
        "map_name": map_name,
        "map_dir": "/root/humble_ws",
    }
    try:
        await car_ws.send_text(json.dumps(payload))
    except Exception as exc:
        return JSONResponse(
            {"success": False, "error": f"Trimiterea comenzii de salvare a eșuat: {exc}"},
            status_code=503,
        )
    return {"success": True, "message": f"Comandă de salvare inițiată pentru {map_name}"}



@router.post("/api/car/path/preview", dependencies=[Depends(authorize_car)])
async def preview_car_path(request: Request):
    global pending_preview
    """Ask the car planner for a path without publishing a navigation goal."""
    if car_ws is None or not car_state["connected"]:
        return JSONResponse(
            {"success": False, "error": "Mașina nu este conectată"},
            status_code=409,
        )
    body = await request.json()
    if not alignment_ready():
        car_alignment.update(
            status="standalone",
            message="Mod direct mașinuță activ (fără aliniere G1).",
            updated_at=time.time(),
        )
        car_transform.update({"x": 0.0, "y": 0.0, "yaw": 0.0})
        _refresh_car_spatial_layers()
    try:
        map_goal = {
            "x": float(body["x"]),
            "y": float(body["y"]),
            "yaw": math.radians(float(body.get("yaw_deg", 0.0))),
        }
    except (KeyError, TypeError, ValueError):
        return JSONResponse(
            {"success": False, "error": "Țintă invalidă"}, status_code=400,
        )
    if not all(math.isfinite(value) for value in map_goal.values()):
        return JSONResponse(
            {"success": False, "error": "Ținta trebuie să fie finită"},
            status_code=400,
        )
    car_map_goal = _car_map_pose_to_odom(map_goal)
    request_id = secrets.token_urlsafe(8)
    pending_preview = {"request_id": request_id, "goal": map_goal, "ready": False, "created": time.monotonic()}
    payload = {
        "type": "compute_path",
        "request_id": request_id,
        "position": {
            "x": car_map_goal["x"], "y": car_map_goal["y"], "z": 0.0,
        },
        "orientation": _yaw_quaternion(car_map_goal["yaw"]),
    }
    try:
        await car_ws.send_text(json.dumps(payload))
    except Exception as exc:
        return JSONResponse(
            {"success": False, "error": f"Cererea traseului a eșuat: {exc}"},
            status_code=503,
        )
    return {
        "success": True,
        "request_id": request_id,
        "map_goal": map_goal,
        "car_map_goal": car_map_goal,
    }


@router.websocket("/ws")
async def dashboard_events(ws: WebSocket):
    expected = os.environ.get("G1_DASHBOARD_TOKEN", "")
    if not expected or not secrets.compare_digest(ws.query_params.get("token", ""), expected):
        await ws.close(code=1008)
        return
    await ws.accept()
    active_ws.append(ws)
    try:
        await ws.send_json(_car_public_state())
        while True:
            # Numai evenimente de afișare; comenzile G1 trec prin API-ul v3.
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if ws in active_ws:
            active_ws.remove(ws)


@router.get("/api/agents/status", dependencies=[Depends(authorize_car)])
async def agents_status():
    snapshot = g1_snapshot()
    pose_age = snapshot.get("pose_age")
    vehicle_age = time.time() - car_state["pose_updated_at"] if car_state["pose_updated_at"] else None
    return {"success": True, "schema": "g1_multi_agent.pose.v1", "server_time_s": time.time(),
            "robot": {"pose": snapshot.get("pose"), "source": snapshot.get("pose_source"),
                      "pose_age_s": pose_age, "online": pose_age is not None and pose_age < 2},
            "vehicle": {"pose": car_state["map_pose"], "connected": car_state["connected"],
                        "pose_age_s": vehicle_age, "online": car_state["connected"] and vehicle_age is not None and vehicle_age < 2}}


@router.get("/api/agents/world", dependencies=[Depends(authorize_car)])
async def agents_world():
    data = await agents_status()
    data.update({"schema": "g1_multi_agent.world.v1", "car": _car_public_state(),
                 "g1_map": g1_map_path(), "g1_navigation": g1_snapshot().get("navigation")})
    return data


async def shutdown():
    if car_auto_align_task and not car_auto_align_task.done():
        car_auto_align_task.cancel()
    for ws in [*active_ws, car_ws]:
        if ws:
            try:
                await ws.close(code=1001)
            except Exception:
                pass
