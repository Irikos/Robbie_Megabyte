#!/usr/bin/env python3
"""Dashboard G1 A* v5: SLAM, localizare si navigatie exclusiv prin ROS 2.

Procesul nu importa unitree_sdk2py. Astfel rclpy poate folosi CycloneDDS din
ROS Humble fara sa incarce in acelasi proces biblioteca DDS livrata de SDK.
"""

from __future__ import annotations

import asyncio
import heapq
import json
import math
import os
import secrets
import struct
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

import rclpy
from fastapi import Body, FastAPI, Header, HTTPException, Query, Request as HttpRequest
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from nav_msgs.msg import Odometry
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import ExternalShutdownException, MultiThreadedExecutor
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from sensor_msgs.msg import PointCloud2
from sensor_msgs_py import point_cloud2
from std_msgs.msg import String
from unitree_api.msg import Request, Response


ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
MAPS = ROOT / "maps"
MAPS_2D = MAPS / "maps_2d"
PARTIAL_MAPS = MAPS / "partial_maps"
NATIVE_MAP_REGISTRY = MAPS / ".native_paths.json"
TOKEN = os.environ.get("G1_DASHBOARD_TOKEN", "")
VOXEL_SIZE = float(os.environ.get("G1_MAP_VOXEL_SIZE", "0.05"))
MAX_POINTS = int(os.environ.get("G1_MAP_MAX_POINTS", "350000"))
SNAPSHOT_INTERVAL_SECONDS = 5.0
ROBOT_MODE_LOCK = asyncio.Lock()
NAV_WAYPOINT_SPACING = 0.80
NAV_ROUTE_SIMPLIFY_EPSILON = 0.08
NAV_INTERMEDIATE_TOLERANCE = 0.30
NAV_FINAL_TOLERANCE = 0.20
NAV_PROGRESS_TIMEOUT = 20.0
NAV_POSE_MAX_AGE = 2.0
RUN_SPEED_MODE = 1


def safe_name(value: str) -> str:
    original = str(value).strip()
    cleaned = "".join(c for c in original if c.isalnum() or c in "_-")
    if not cleaned or cleaned != original or len(cleaned) > 64:
        raise ValueError("Numele trebuie sa aiba 1-64 caractere: litere, cifre, _ sau -")
    return cleaned


def create_mapping_session() -> Path:
    """Creează imediat un director unic pentru o singură cartografiere."""
    stamp = time.strftime("mapping_%Y%m%d_%H%M%S")
    for _attempt in range(20):
        nanoseconds = time.time_ns() % 1_000_000_000
        session = PARTIAL_MAPS / f"{stamp}_{nanoseconds:09d}"
        try:
            session.mkdir(parents=True, exist_ok=False)
        except FileExistsError:
            continue
        # Subfolderul există din momentul apăsării butonului, nu doar după
        # sosirea primului nor SLAM.
        (session / "maps_2d").mkdir()
        return session
    raise RuntimeError("Nu s-a putut crea un director unic pentru sesiunea de mapping")


def native_map_paths() -> dict[str, str]:
    """Asociaza copia PCD locala cu adresa vazuta de serviciul SLAM."""
    try:
        value = json.loads(NATIVE_MAP_REGISTRY.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(value, dict):
        return {}
    return {
        str(name): str(path)
        for name, path in value.items()
        if isinstance(name, str) and isinstance(path, str) and path.startswith("/")
    }


def remember_native_map(local_name: str, native_path: str) -> None:
    paths = native_map_paths()
    paths[local_name] = native_path
    temporary = NATIVE_MAP_REGISTRY.with_name(NATIVE_MAP_REGISTRY.name + ".tmp")
    temporary.write_text(
        json.dumps(paths, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    temporary.replace(NATIVE_MAP_REGISTRY)


def yaw_from_quaternion(x: float, y: float, z: float, w: float) -> float:
    return math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))


def pcd_header(count: int) -> str:
    return (
        "# .PCD v0.7\nVERSION 0.7\nFIELDS x y z\n"
        "SIZE 4 4 4\nTYPE F F F\nCOUNT 1 1 1\n"
        f"WIDTH {count}\nHEIGHT 1\nPOINTS {count}\nDATA ascii\n"
    )


def write_pcd_atomic(path: Path, points: list[tuple[float, float, float]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="ascii") as stream:
        stream.write(pcd_header(len(points)))
        for x, y, z in points:
            stream.write(f"{x:.4f} {y:.4f} {z:.4f}\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def read_pcd(path: Path) -> list[tuple[float, float, float]]:
    """Citeste PCD ASCII sau binary cu campuri x/y/z de tip float32."""
    raw = path.read_bytes()
    marker = raw.find(b"DATA ")
    if marker < 0:
        raise ValueError("Fisier PCD fara sectiune DATA")
    header_end = raw.find(b"\n", marker)
    if header_end < 0:
        raise ValueError("Antet PCD incomplet")
    header = raw[: header_end + 1].decode("ascii", errors="replace")
    body = raw[header_end + 1 :]
    metadata: dict[str, list[str]] = {}
    data_kind = ""
    for line in header.splitlines():
        parts = line.strip().split()
        if not parts or parts[0].startswith("#"):
            continue
        if parts[0].upper() == "DATA":
            data_kind = parts[1].lower()
        else:
            metadata[parts[0].upper()] = parts[1:]
    fields = metadata.get("FIELDS", [])
    if not all(axis in fields for axis in ("x", "y", "z")):
        raise ValueError("PCD fara campurile x/y/z")
    result: list[tuple[float, float, float]] = []
    if data_kind == "ascii":
        indices = [fields.index(axis) for axis in ("x", "y", "z")]
        for line in body.decode("ascii", errors="ignore").splitlines():
            values = line.split()
            try:
                point = tuple(float(values[index]) for index in indices)
            except (IndexError, ValueError):
                continue
            if all(math.isfinite(v) for v in point):
                result.append(point)
        return result
    if data_kind != "binary":
        raise ValueError(f"Format PCD nesuportat: {data_kind}")
    sizes = [int(v) for v in metadata.get("SIZE", [])]
    types = metadata.get("TYPE", [])
    counts = [int(v) for v in metadata.get("COUNT", ["1"] * len(fields))]
    if not (len(fields) == len(sizes) == len(types) == len(counts)):
        raise ValueError("Descriere PCD binary invalida")
    offsets: dict[str, int] = {}
    point_step = 0
    for field, size, count in zip(fields, sizes, counts):
        offsets[field] = point_step
        point_step += size * count
    if any(types[fields.index(axis)].upper() != "F" or sizes[fields.index(axis)] != 4 for axis in ("x", "y", "z")):
        raise ValueError("PCD binary x/y/z trebuie sa fie float32")
    declared = int((metadata.get("POINTS") or metadata.get("WIDTH") or ["0"])[0])
    available = len(body) // point_step
    for index in range(min(declared or available, available)):
        base = index * point_step
        point = tuple(struct.unpack_from("<f", body, base + offsets[axis])[0] for axis in ("x", "y", "z"))
        if all(math.isfinite(v) for v in point):
            result.append(point)
    return result


def flatten_cloud_xy(
    points: list[tuple[float, float, float]],
    min_height: float = -0.30,
    max_height: float = 1.20,
) -> list[tuple[float, float, float]]:
    """Proiectează în XY o hartă 3D deja stabilizată."""
    cells: dict[tuple[int, int], tuple[float, float, float]] = {}
    for x, y, z in points:
        if all(math.isfinite(value) for value in (x, y, z)) and min_height <= z <= max_height:
            cells[(math.floor(x / VOXEL_SIZE), math.floor(y / VOXEL_SIZE))] = (x, y, 0.5)
    return list(cells.values())


def plan_xy_route(
    points: list[tuple[float, float, float]],
    start: tuple[float, float],
    goal: tuple[float, float],
    base_resolution: float = 0.20,
    inflation: float = 0.35,
) -> dict[str, Any]:
    """Planifică A* 2D peste obstacolele extrase din PCD, fără a mișca robotul."""
    obstacle_points = [
        (x, y) for x, y, z in points
        if all(math.isfinite(value) for value in (x, y, z)) and 0.10 <= z <= 1.80
    ]
    coordinates = obstacle_points + [start, goal]
    min_x = min(value[0] for value in coordinates) - 1.5
    max_x = max(value[0] for value in coordinates) + 1.5
    min_y = min(value[1] for value in coordinates) - 1.5
    max_y = max(value[1] for value in coordinates) + 1.5
    span_x = max_x - min_x
    span_y = max_y - min_y
    resolution = max(base_resolution, span_x / 360.0, span_y / 360.0)
    width = max(2, math.ceil(span_x / resolution) + 1)
    height = max(2, math.ceil(span_y / resolution) + 1)

    def cell(position: tuple[float, float]) -> tuple[int, int]:
        return (
            min(width - 1, max(0, round((position[0] - min_x) / resolution))),
            min(height - 1, max(0, round((position[1] - min_y) / resolution))),
        )

    occupied = {cell(position) for position in obstacle_points}
    inflation_cells = max(0, math.ceil(inflation / resolution))
    if inflation_cells:
        expanded: set[tuple[int, int]] = set()
        radius_squared = inflation_cells * inflation_cells
        for ox, oy in occupied:
            for dx in range(-inflation_cells, inflation_cells + 1):
                for dy in range(-inflation_cells, inflation_cells + 1):
                    candidate = (ox + dx, oy + dy)
                    if (
                        dx * dx + dy * dy <= radius_squared
                        and 0 <= candidate[0] < width
                        and 0 <= candidate[1] < height
                    ):
                        expanded.add(candidate)
        occupied = expanded

    def nearest_free(origin: tuple[int, int]) -> tuple[int, int]:
        if origin not in occupied:
            return origin
        for radius in range(1, max(4, inflation_cells + 3)):
            candidates = []
            for dx in range(-radius, radius + 1):
                candidates.extend(((origin[0] + dx, origin[1] - radius), (origin[0] + dx, origin[1] + radius)))
            for dy in range(-radius + 1, radius):
                candidates.extend(((origin[0] - radius, origin[1] + dy), (origin[0] + radius, origin[1] + dy)))
            for candidate in candidates:
                if 0 <= candidate[0] < width and 0 <= candidate[1] < height and candidate not in occupied:
                    return candidate
        raise ValueError("Poziția sau destinația este blocată de obstacole")

    start_cell = nearest_free(cell(start))
    goal_cell = nearest_free(cell(goal))
    queue: list[tuple[float, float, tuple[int, int]]] = []
    heapq.heappush(queue, (0.0, 0.0, start_cell))
    came_from: dict[tuple[int, int], tuple[int, int]] = {}
    cost = {start_cell: 0.0}
    directions = (
        (-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0),
        (-1, -1, math.sqrt(2.0)), (-1, 1, math.sqrt(2.0)),
        (1, -1, math.sqrt(2.0)), (1, 1, math.sqrt(2.0)),
    )
    found = False
    while queue:
        _priority, current_cost, current = heapq.heappop(queue)
        if current_cost > cost.get(current, math.inf):
            continue
        if current == goal_cell:
            found = True
            break
        for dx, dy, step_cost in directions:
            candidate = (current[0] + dx, current[1] + dy)
            if not (0 <= candidate[0] < width and 0 <= candidate[1] < height):
                continue
            if candidate in occupied:
                continue
            if dx and dy and (
                (current[0] + dx, current[1]) in occupied
                or (current[0], current[1] + dy) in occupied
            ):
                continue
            candidate_cost = current_cost + step_cost
            if candidate_cost >= cost.get(candidate, math.inf):
                continue
            cost[candidate] = candidate_cost
            came_from[candidate] = current
            heuristic = math.hypot(goal_cell[0] - candidate[0], goal_cell[1] - candidate[1])
            heapq.heappush(queue, (candidate_cost + heuristic, candidate_cost, candidate))
    if not found:
        raise ValueError("A* nu a găsit o rută liberă până la destinație")

    cells = [goal_cell]
    while cells[-1] != start_cell:
        cells.append(came_from[cells[-1]])
    cells.reverse()
    route = [start]
    route.extend((min_x + x * resolution, min_y + y * resolution) for x, y in cells[1:-1])
    route.append(goal)
    distance = sum(
        math.hypot(route[index][0] - route[index - 1][0], route[index][1] - route[index - 1][1])
        for index in range(1, len(route))
    )
    return {
        "points": [[round(x, 3), round(y, 3)] for x, y in route],
        "distance": round(distance, 3),
        "resolution": round(resolution, 3),
        "obstacles": len(occupied),
    }


def execution_waypoints(
    route: list[list[float]],
    spacing: float = NAV_WAYPOINT_SPACING,
    simplify_epsilon: float = NAV_ROUTE_SIMPLIFY_EPSILON,
) -> list[tuple[float, float]]:
    """Reduce ruta A* la ținte suficient de dese pentru API 1102.

    Ramer-Douglas-Peucker elimină zig-zag-ul de grilă, iar subdivizarea
    ulterioară nu lasă navigatorul nativ să taie segmente foarte lungi.
    """
    points = [(float(point[0]), float(point[1])) for point in route]
    if len(points) < 2 or spacing <= 0.0:
        raise ValueError("Ruta executabilă trebuie să conțină cel puțin două puncte")
    if not all(math.isfinite(value) for point in points for value in point):
        raise ValueError("Ruta executabilă conține coordonate nefinite")

    def distance_to_segment(
        point: tuple[float, float],
        start: tuple[float, float],
        end: tuple[float, float],
    ) -> float:
        dx, dy = end[0] - start[0], end[1] - start[1]
        length_squared = dx * dx + dy * dy
        if length_squared <= 1e-12:
            return math.hypot(point[0] - start[0], point[1] - start[1])
        fraction = min(1.0, max(0.0, (
            (point[0] - start[0]) * dx + (point[1] - start[1]) * dy
        ) / length_squared))
        projection = (start[0] + fraction * dx, start[1] + fraction * dy)
        return math.hypot(point[0] - projection[0], point[1] - projection[1])

    kept = {0, len(points) - 1}
    pending = [(0, len(points) - 1)]
    while pending:
        first, last = pending.pop()
        farthest_index = -1
        farthest_distance = simplify_epsilon
        for index in range(first + 1, last):
            distance = distance_to_segment(points[index], points[first], points[last])
            if distance > farthest_distance:
                farthest_distance = distance
                farthest_index = index
        if farthest_index >= 0:
            kept.add(farthest_index)
            pending.append((first, farthest_index))
            pending.append((farthest_index, last))
    simplified = [points[index] for index in sorted(kept)]

    result = [simplified[0]]
    for start, end in zip(simplified, simplified[1:]):
        length = math.hypot(end[0] - start[0], end[1] - start[1])
        pieces = max(1, math.ceil(length / spacing))
        for piece in range(1, pieces + 1):
            fraction = piece / pieces
            point = (
                start[0] + (end[0] - start[0]) * fraction,
                start[1] + (end[1] - start[1]) * fraction,
            )
            if math.hypot(point[0] - result[-1][0], point[1] - result[-1][1]) > 1e-6:
                result.append(point)
    if len(result) < 2:
        raise ValueError("Ruta executabilă are lungime zero")
    return result


def navigation_target_payload(
    point: tuple[float, float], yaw: float, speed: float
) -> dict[str, Any]:
    """Construiește o țintă 1102 în modul de ocolire a obstacolelor."""
    return {
        "data": {
            "targetPose": {
                "x": point[0], "y": point[1], "z": 0.0,
                "q_x": 0.0, "q_y": 0.0,
                "q_z": math.sin(yaw / 2.0), "q_w": math.cos(yaw / 2.0),
            },
            "mode": 0,
            "speed": speed,
        }
    }


async def enforce_run_profile() -> dict[str, Any]:
    """Reafirmă RUN după ce navigatorul nativ poate reseta profilul de mers."""
    result = await command(
        7107, {"data": RUN_SPEED_MODE}, timeout=5.0, service="sport"
    )
    if result.get("success"):
        return result
    return {
        **result,
        "error": (
            "Profilul RUN nu a fost acceptat de API 7107: "
            f"{result.get('error', 'eroare necunoscută')}"
        ),
    }


async def dispatch_navigation_waypoint(
    point: tuple[float, float], yaw: float, speed: float
) -> dict[str, Any]:
    """Trimite 1102, apoi repară profilul pe care navigatorul îl poate reseta."""
    navigation = await command(
        1102, navigation_target_payload(point, yaw, speed), timeout=8.0
    )
    if not navigation.get("success"):
        return navigation
    run_profile = await enforce_run_profile()
    if not run_profile.get("success"):
        return {
            **run_profile,
            "navigation_response": navigation.get("response"),
            "error": (
                "Waypoint-ul 1102 a fost acceptat, dar navigația a fost oprită "
                f"deoarece RUN nu a putut fi reafirmat: {run_profile.get('error')}"
            ),
        }
    return {**navigation, "run_profile": run_profile}


class RosBridge(Node):
    def __init__(self) -> None:
        super().__init__("g1_dashboard_v5")
        self.lock = threading.RLock()
        self.response_condition = threading.Condition(self.lock)
        self.mode = "idle"
        self.pose = {"x": 0.0, "y": 0.0, "yaw": 0.0}
        self.pose_source = "none"
        self.pose_at = 0.0
        self.cloud_at = 0.0
        self.cloud_source = "none"
        self.raw_lidar_at = 0.0
        self.base_odom_at = 0.0
        self.native_mapping_cloud_at = 0.0
        self.native_mapping_odom_at = 0.0
        self.native_odom_frame = ""
        self.native_child_frame = ""
        self.map_frame = ""
        self.mapping_error = ""
        self.cloud_processing = threading.Lock()
        self.last_cloud_processed = 0.0
        self.base_odom_pose = {"x": 0.0, "y": 0.0, "yaw": 0.0}
        self.mapping_origin: Optional[dict[str, float]] = None
        self.mapping_backend = "none"
        self.mapping_paused = False
        self.slam_info_at = 0.0
        self.slam_info: dict[str, Any] = {}
        self.voxels: dict[tuple[int, int, int], tuple[float, float, float]] = {}
        self.map_revision = 0
        self.scan2d_cells: dict[tuple[int, int], tuple[float, float, float]] = {}
        self.scan2d_at = 0.0
        self.scan2d_revision = 0
        self.responses: dict[int, dict[str, Any]] = {}
        self.responses_by_api: dict[int, dict[str, Any]] = {}
        self.last_api_response: Optional[dict[str, Any]] = None
        self.request_id = time.monotonic_ns()
        self.session_dir: Optional[Path] = None
        self.snapshot_index = 0
        self.last_snapshot: Optional[Path] = None
        self.last_snapshot_error = ""
        self.pending_route: Optional[dict[str, Any]] = None
        self.navigation_paused = False
        self.navigation_cancel_requested = False
        self.navigation_status: dict[str, Any] = {
            "state": "idle",
            "message": "Nicio rută în execuție",
            "waypoint": 0,
            "waypoints": 0,
        }
        self.robot_mode = "unknown"
        self.robot_fsm: Optional[int] = None
        stream_callbacks = ReentrantCallbackGroup()

        sensor_qos = QoSProfile(
            depth=5,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.VOLATILE,
        )
        # Păstrăm separat QoS-ul norilor SLAM și al LiDARului brut.
        unitree_cloud_qos = QoSProfile(
            depth=1,
            reliability=ReliabilityPolicy.BEST_EFFORT,
            durability=DurabilityPolicy.VOLATILE,
        )
        reliable_qos = QoSProfile(
            depth=10,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.VOLATILE,
        )
        self.request_publisher = self.create_publisher(
            Request, "/api/slam_operate/request", reliable_qos
        )
        self.sport_request_publisher = self.create_publisher(
            Request, "/api/sport/request", reliable_qos
        )
        self.create_subscription(
            Response, "/api/slam_operate/response", self._on_response, reliable_qos
        )
        self.create_subscription(
            Response, "/api/sport/response", self._on_response, reliable_qos
        )
        self.create_subscription(
            String, "/slam_info", self._on_slam_info, reliable_qos,
            callback_group=stream_callbacks,
        )
        self.create_subscription(
            PointCloud2, "/unitree/slam_mapping/points",
            lambda msg: self._on_cloud(msg, "mapping"), unitree_cloud_qos,
            callback_group=stream_callbacks,
        )
        self.create_subscription(
            PointCloud2, "/unitree/slam_localization/points",
            lambda msg: self._on_cloud(msg, "localization"), unitree_cloud_qos,
            callback_group=stream_callbacks,
        )
        self.create_subscription(
            PointCloud2, "/unitree/slam_relocation/points",
            lambda msg: self._on_cloud(msg, "localization"), unitree_cloud_qos,
            callback_group=stream_callbacks,
        )
        self.create_subscription(
            PointCloud2, "/utlidar/cloud_livox_mid360", self._on_raw_lidar,
            sensor_qos, callback_group=stream_callbacks,
        )
        self.get_logger().info("v5 pornit: ROS 2 Humble + CycloneDDS, fara SDK in proces")

    def _on_response(self, message: Response) -> None:
        self._store_response(message)

    def _store_response(
        self,
        message: Response,
    ) -> None:
        try:
            payload = json.loads(message.data or "{}")
        except json.JSONDecodeError:
            payload = {"raw": message.data}
        record = {
            "request_id": int(message.header.identity.id),
            "api_id": int(message.header.identity.api_id),
            "status_code": int(message.header.status.code),
            "payload": payload,
            "received_at": time.monotonic(),
        }
        with self.response_condition:
            self.responses[record["request_id"]] = record
            self.responses_by_api[record["api_id"]] = record
            self.last_api_response = record
            self.response_condition.notify_all()

    def _on_slam_info(self, message: String) -> None:
        try:
            value = json.loads(message.data)
        except json.JSONDecodeError:
            value = {"raw": message.data}
        with self.lock:
            self.slam_info = value
            self.slam_info_at = time.time()
            # Unele versiuni Unitree publica pozitia de localizare numai in
            # /slam_info, nu si pe topicul Odometry dedicat.
            if self.mode == "localization" and value.get("type") in {"pos_info", "robot_data"}:
                pose = (value.get("data") or {}).get("currentPose") or {}
                try:
                    x = float(pose["x"])
                    y = float(pose["y"])
                    if "yaw" in pose:
                        yaw = float(pose["yaw"])
                    else:
                        yaw = yaw_from_quaternion(
                            float(pose.get("q_x", 0.0)), float(pose.get("q_y", 0.0)),
                            float(pose.get("q_z", 0.0)), float(pose.get("q_w", 1.0)),
                        )
                except (KeyError, TypeError, ValueError):
                    pass
                else:
                    self.pose = {"x": x, "y": y, "yaw": yaw}
                    self.pose_source = "localization"
                    self.pose_at = self.slam_info_at

    @staticmethod
    def _relative_pose(
        pose: dict[str, float], origin: dict[str, float]
    ) -> dict[str, float]:
        """Exprimă odometria pelvisului în cadrul sesiunii curente."""
        dx = pose["x"] - origin["x"]
        dy = pose["y"] - origin["y"]
        co, so = math.cos(origin["yaw"]), math.sin(origin["yaw"])
        return {
            "x": co * dx + so * dy,
            "y": -so * dx + co * dy,
            "yaw": math.atan2(
                math.sin(pose["yaw"] - origin["yaw"]),
                math.cos(pose["yaw"] - origin["yaw"]),
            ),
        }

    @staticmethod
    def _livox_to_base(x: float, y: float, z: float) -> tuple[float, float, float]:
        """Extrinsecul Mid360 -> baza G1 folosit de harta 3D funcțională."""
        roll, pitch = 3.14, 0.04014257279586953
        cr, sr = math.cos(roll), math.sin(roll)
        cp, sp = math.cos(pitch), math.sin(pitch)
        x1, y1, z1 = cp * x + sp * z, y, -sp * x + cp * z
        return (
            x1 + 0.0002835,
            cr * y1 - sr * z1 + 0.00003,
            sr * y1 + cr * z1 + 0.40618,
        )

    def _on_base_odom(self, message: Odometry) -> None:
        position = message.pose.pose.position
        orientation = message.pose.pose.orientation
        absolute = {
            "x": float(position.x),
            "y": float(position.y),
            "yaw": yaw_from_quaternion(
                float(orientation.x), float(orientation.y),
                float(orientation.z), float(orientation.w),
            ),
        }
        now = time.time()
        with self.lock:
            self.base_odom_pose = absolute
            self.base_odom_at = now

    def _on_raw_lidar(self, message: PointCloud2) -> None:
        # Diagnostic only: raw sensor coordinates are NOT a SLAM map.
        with self.lock:
            self.raw_lidar_at = time.time()

    def _on_odom(self, message: Odometry, source: str) -> None:
        now = time.time()
        with self.lock:
            if source == "mapping":
                self.native_mapping_odom_at = now
                self.native_odom_frame = message.header.frame_id
                self.native_child_frame = message.child_frame_id
            if self.mode != source:
                return
            frame = message.header.frame_id
            if source == "mapping" and self.map_frame and frame != self.map_frame:
                self.mapping_error = f"Cadru odometrie schimbat: {frame} != {self.map_frame}"
                return
            position = message.pose.pose.position
            orientation = message.pose.pose.orientation
            self.pose = {
                "x": float(position.x), "y": float(position.y),
                "yaw": yaw_from_quaternion(
                    float(orientation.x), float(orientation.y),
                    float(orientation.z), float(orientation.w),
                ),
            }
            self.pose_source = source
            self.pose_at = now

    def _on_cloud(self, message: PointCloud2, source: str) -> None:
        now = time.time()
        with self.lock:
            if source == "mapping":
                self.native_mapping_cloud_at = now
            if self.mode != source:
                return
            if source != "mapping":
                self.cloud_at, self.cloud_source = now, source
                return
            if self.mapping_paused:
                return
            frame = message.header.frame_id
            # No inferred extrinsics or second application of robot pose.
            # Accept only a fixed frame shared with native SLAM odometry.
            if (not frame or frame != self.native_odom_frame
                    or frame == self.native_child_frame
                    or (self.map_frame and frame != self.map_frame)):
                self.mapping_error = (
                    f"Cadre SLAM incompatibile: cloud={frame}, "
                    f"odom={self.native_odom_frame}, body={self.native_child_frame}. "
                    "Nu acumulez puncte fără un cadru fix comun."
                )
                return
            if not self.pose_at or now - self.pose_at > 2.0:
                self.mapping_error = "Odometria SLAM nu este proaspătă."
                return
            revision = self.map_revision
        # Drop concurrent/backlogged clouds: render at most 5 Hz.
        if not self.cloud_processing.acquire(blocking=False):
            return
        try:
            if time.monotonic() - self.last_cloud_processed < 0.2:
                return
            received = {}
            planar = {}
            for item in point_cloud2.read_points(
                message, field_names=("x", "y", "z"), skip_nans=True
            ):
                x, y, z = (float(value) for value in item)
                if not all(math.isfinite(v) for v in (x, y, z)):
                    continue
                received[(math.floor(x / VOXEL_SIZE), math.floor(y / VOXEL_SIZE),
                          math.floor(z / VOXEL_SIZE))] = (x, y, z)
                if -0.80 <= z <= 0.50:
                    planar[(math.floor(x / VOXEL_SIZE),
                            math.floor(y / VOXEL_SIZE))] = (x, y, 0.5)
            with self.lock:
                if (self.mode != "mapping" or self.mapping_paused
                        or self.map_revision != revision):
                    return
                self.map_frame = frame
                self.voxels.update(received)
                self.scan2d_cells.update(planar)
                for cells in (self.voxels, self.scan2d_cells):
                    if len(cells) > MAX_POINTS:
                        for key in list(cells)[:len(cells) - MAX_POINTS]:
                            del cells[key]
                self.cloud_at = self.scan2d_at = now
                self.cloud_source = "/unitree/slam_mapping/points"
                self.mapping_error = ""
                self.map_revision += 1
                self.scan2d_revision += 1
                self.last_cloud_processed = time.monotonic()
        except Exception as exc:
            with self.lock:
                self.mapping_error = f"Nor SLAM invalid: {exc}"
        finally:
            self.cloud_processing.release()

    def clear_map(self) -> None:
        with self.lock:
            self.map_frame = ""
            self.mapping_error = ""
            self.voxels.clear()
            self.scan2d_cells.clear()
            self.map_revision += 1
            self.scan2d_revision += 1
            self.cloud_at = 0.0
            self.cloud_source = "none"
            self.scan2d_at = 0.0

    def scan2d_points(self, limit: int = 0) -> list[tuple[float, float, float]]:
        with self.lock:
            result = list(self.scan2d_cells.values())
        if limit and len(result) > limit:
            step = math.ceil(len(result) / limit)
            result = result[::step]
        return result

    def set_loaded_map(self, points: list[tuple[float, float, float]]) -> None:
        with self.lock:
            self.voxels = {
                (
                    math.floor(x / VOXEL_SIZE),
                    math.floor(y / VOXEL_SIZE),
                    math.floor(z / VOXEL_SIZE),
                ): (x, y, z)
                for x, y, z in points
            }
            self.map_revision += 1

    def points(self, limit: Optional[int] = None) -> list[tuple[float, float, float]]:
        with self.lock:
            result = list(self.voxels.values())
        if limit and len(result) > limit:
            step = math.ceil(len(result) / limit)
            result = result[::step]
        return result

    def send_request(
        self,
        api_id: int,
        parameters: dict[str, Any],
        publisher=None,
    ) -> int:
        with self.lock:
            self.request_id += 1
            request_id = self.request_id
        message = Request()
        message.header.identity.id = request_id
        message.header.identity.api_id = int(api_id)
        message.header.lease.id = 0
        message.header.policy.priority = 1
        message.header.policy.noreply = False
        message.parameter = json.dumps(parameters, separators=(",", ":"))
        message.binary = []
        (publisher or self.request_publisher).publish(message)
        return request_id

    def wait_response(
        self,
        request_id: int,
        api_id: int,
        sent_at: float,
        timeout: float,
    ) -> Optional[dict[str, Any]]:
        deadline = time.monotonic() + timeout
        with self.response_condition:
            while True:
                exact = self.responses.pop(request_id, None)
                if exact:
                    return exact
                compatible = self.responses_by_api.get(api_id)
                if compatible and compatible["received_at"] >= sent_at:
                    return compatible
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self.response_condition.wait(remaining)

    def state(self) -> dict[str, Any]:
        now = time.time()
        with self.lock:
            info = dict(self.slam_info)
            return {
                "mode": self.mode,
                "pose": dict(self.pose),
                "pose_source": self.pose_source,
                "pose_age": None if not self.pose_at else round(now - self.pose_at, 3),
                "cloud_source": self.cloud_source,
                "cloud_age": None if not self.cloud_at else round(now - self.cloud_at, 3),
                "lidar_age": None if not self.raw_lidar_at else round(now - self.raw_lidar_at, 3),
                "base_odom_age": None if not self.base_odom_at else round(now - self.base_odom_at, 3),
                "native_mapping_cloud_age": None if not self.native_mapping_cloud_at else round(now - self.native_mapping_cloud_at, 3),
                "native_mapping_odom_age": None if not self.native_mapping_odom_at else round(now - self.native_mapping_odom_at, 3),
                "mapping_backend": self.mapping_backend,
                "map_frame": self.map_frame,
                "native_odom_frame": self.native_odom_frame,
                "mapping_error": self.mapping_error,
                "mapping_paused": self.mapping_paused,
                "slam_info_age": None if not self.slam_info_at else round(now - self.slam_info_at, 3),
                "point_count": len(self.voxels),
                "map_revision": self.map_revision,
                "scan2d_age": None if not self.scan2d_at else round(now - self.scan2d_at, 3),
                "scan2d_point_count": len(self.scan2d_cells),
                "scan2d_revision": self.scan2d_revision,
                "session": self.session_dir.name if self.session_dir else None,
                "snapshots": self.snapshot_index,
                "snapshot_interval": SNAPSHOT_INTERVAL_SECONDS,
                "last_snapshot": self.last_snapshot.name if self.last_snapshot else None,
                "snapshot_error": self.last_snapshot_error,
                "slam_info": info,
                "last_api_response": self.last_api_response,
                "navigation": dict(self.navigation_status),
                "robot_mode": self.robot_mode,
                "robot_fsm": self.robot_fsm,
                "rmw": os.environ.get("RMW_IMPLEMENTATION", ""),
            }


class OdomReceiver(Node):
    """Nod usor, separat de deserializarea norilor mari de puncte."""

    def __init__(self, target: RosBridge) -> None:
        super().__init__("g1_dashboard_v5_odom")
        qos = QoSProfile(
            depth=5,
            # Publisherul Unitree livrează continuu în testul RELIABLE.
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.VOLATILE,
        )
        self.create_subscription(
            Odometry, "/state_estimator/odom_pelvis", target._on_base_odom, qos
        )
        self.create_subscription(
            Odometry, "/unitree/slam_mapping/odom",
            lambda msg: target._on_odom(msg, "mapping"), qos,
        )
        self.create_subscription(
            Odometry, "/unitree/slam_localization/odom",
            lambda msg: target._on_odom(msg, "localization"), qos,
        )
        self.create_subscription(
            Odometry, "/unitree/slam_relocation/odom",
            lambda msg: target._on_odom(msg, "localization"), qos,
        )


bridge: Optional[RosBridge] = None
odom_receiver: Optional[OdomReceiver] = None
ros_thread: Optional[threading.Thread] = None
odom_thread: Optional[threading.Thread] = None
snapshot_task: Optional[asyncio.Task] = None
navigation_task: Optional[asyncio.Task] = None


def spin_ros(node: Node, threads: int = 1) -> None:
    executor = MultiThreadedExecutor(num_threads=threads)
    executor.add_node(node)
    try:
        executor.spin()
    except ExternalShutdownException:
        pass
    finally:
        executor.shutdown(timeout_sec=2.0)


async def snapshot_loop() -> None:
    next_snapshot_at = time.monotonic() + SNAPSHOT_INTERVAL_SECONDS
    while True:
        await asyncio.sleep(max(0.0, next_snapshot_at - time.monotonic()))
        next_snapshot_at += SNAPSHOT_INTERVAL_SECONDS
        current = bridge
        if current is None:
            continue
        with current.lock:
            active = (
                current.mode == "mapping"
                and current.session_dir is not None
                and not current.mapping_paused
            )
            session = current.session_dir
            current.snapshot_index += 1 if active else 0
            index = current.snapshot_index
            points = list(current.voxels.values()) if active else []
            scan2d = list(current.scan2d_cells.values()) if active else []
        if not active or not points or session is None:
            continue
        stamp = time.strftime("%Y%m%d_%H%M%S")
        path = session / f"partial_{index:06d}_{stamp}.pcd"
        try:
            await asyncio.to_thread(write_pcd_atomic, path, points)
            if scan2d:
                scan_dir = session / "maps_2d"
                scan_path = scan_dir / f"partial_{index:06d}_{stamp}_2d.pcd"
                await asyncio.to_thread(write_pcd_atomic, scan_path, scan2d)
            with current.lock:
                current.last_snapshot = path
                current.last_snapshot_error = ""
        except Exception as exc:
            with current.lock:
                current.last_snapshot_error = str(exc)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global bridge, odom_receiver, ros_thread, odom_thread, snapshot_task, navigation_task
    MAPS.mkdir(parents=True, exist_ok=True)
    MAPS_2D.mkdir(parents=True, exist_ok=True)
    PARTIAL_MAPS.mkdir(parents=True, exist_ok=True)
    if os.environ.get("RMW_IMPLEMENTATION") != "rmw_cyclonedds_cpp":
        raise RuntimeError("v5 cere RMW_IMPLEMENTATION=rmw_cyclonedds_cpp")
    rclpy.init(args=[])
    bridge = RosBridge()
    odom_receiver = OdomReceiver(bridge)
    ros_thread = threading.Thread(target=spin_ros, args=(bridge, 4), daemon=True)
    odom_thread = threading.Thread(target=spin_ros, args=(odom_receiver, 1), daemon=True)
    ros_thread.start()
    odom_thread.start()
    snapshot_task = asyncio.create_task(snapshot_loop())
    try:
        yield
    finally:
        if navigation_task and not navigation_task.done():
            navigation_task.cancel()
            try:
                await navigation_task
            except asyncio.CancelledError:
                pass
        if snapshot_task:
            snapshot_task.cancel()
            try:
                await snapshot_task
            except asyncio.CancelledError:
                pass
        if rclpy.ok():
            rclpy.shutdown()
        if ros_thread:
            ros_thread.join(timeout=3.0)
        if odom_thread:
            odom_thread.join(timeout=3.0)
        if bridge:
            bridge.destroy_node()
        if odom_receiver:
            odom_receiver.destroy_node()


app = FastAPI(title="G1 Dashboard A* v5", version="5.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(FRONTEND)), name="static")


@app.middleware("http")
async def disable_frontend_cache(request, call_next):
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


def ros() -> RosBridge:
    if bridge is None:
        raise HTTPException(503, "Nodul ROS nu este pornit")
    return bridge


def authorize(x_dashboard_token: str = Header(default="")) -> None:
    if TOKEN and x_dashboard_token != TOKEN:
        raise HTTPException(401, "Token dashboard invalid")


def response_ok(response: Optional[dict[str, Any]]) -> bool:
    if not response or response.get("status_code") != 0:
        return False
    payload = response.get("payload") or {}
    return payload.get("succeed", True) is not False and int(payload.get("errorCode", 0) or 0) == 0


def fsm_id_from_result(result: dict[str, Any]) -> Optional[int]:
    """Extrage FSM-ul raportat de API 7001 din variantele de firmware G1."""
    response = result.get("response") or {}
    payload = response.get("payload") or {}
    data = payload.get("data")
    candidates = [data]
    if isinstance(data, dict):
        candidates = [data.get("fsm_id"), data.get("fsmId"), data.get("id")]
    for value in candidates:
        if isinstance(value, bool) or value is None:
            continue
        try:
            return int(value)
        except (TypeError, ValueError):
            continue
    return None


async def command(
    api_id: int,
    parameters: dict[str, Any],
    timeout: float = 6.0,
    service: str = "slam",
) -> dict[str, Any]:
    node = ros()
    if service == "sport":
        publisher = node.sport_request_publisher
        topic = "/api/sport/request"
        response_topic = "/api/sport/response"
    else:
        publisher = node.request_publisher
        topic = "/api/slam_operate/request"
        response_topic = "/api/slam_operate/response"
    discovery_deadline = time.monotonic() + 2.0
    while publisher.get_subscription_count() < 1:
        if time.monotonic() >= discovery_deadline:
            return {
                "success": False,
                "error": f"Serviciul Unitree nu este descoperit pe {topic}",
            }
        await asyncio.sleep(0.05)
    sent_at = time.monotonic()
    request_id = node.send_request(api_id, parameters, publisher)
    response = await asyncio.to_thread(
        node.wait_response, request_id, api_id, sent_at, timeout
    )
    if not response:
        response_publishers = node.count_publishers(response_topic)
        detail = (
            "serviciul nu are publisher pe topicul de răspuns"
            if response_publishers == 0
            else f"publisheri răspuns vizibili: {response_publishers}"
        )
        return {
            "success": False,
            "error": f"API {api_id} nu a răspuns în {timeout:.0f}s ({detail})",
            "request_id": request_id,
            "response_publishers": response_publishers,
        }
    if not response_ok(response):
        payload = response.get("payload") or {}
        return {
            "success": False,
            "error": payload.get("info") or f"API {api_id} respins (status={response.get('status_code')})",
            "response": response,
        }
    return {"success": True, "response": response}


def set_navigation_status(node: RosBridge, state: str, message: str, **values: Any) -> None:
    with node.lock:
        node.navigation_status = {
            **node.navigation_status,
            "state": state,
            "message": message,
            **values,
        }


def cancel_navigation_tracking(node: RosBridge, message: str) -> None:
    """Oprește executorul local; apelantul decide separat comanda fizică ROS."""
    with node.lock:
        node.navigation_cancel_requested = True
        node.navigation_paused = False
        node.pending_route = None
        node.navigation_status = {
            **node.navigation_status,
            "state": "cancelled",
            "message": message,
        }


async def wait_for_navigation_waypoint(
    node: RosBridge,
    point: tuple[float, float],
    tolerance: float,
    waypoint_index: int,
    waypoint_count: int,
) -> tuple[bool, str]:
    """Așteaptă poziția localizată, cu oprire la pose vechi sau lipsă de progres."""
    best_distance = math.inf
    last_progress_at = time.monotonic()
    while True:
        with node.lock:
            cancelled = node.navigation_cancel_requested
            paused = node.navigation_paused
            mode = node.mode
            pose = dict(node.pose)
            pose_at = node.pose_at
        if cancelled:
            return False, "Execuția rutei a fost anulată"
        if mode != "localization":
            return False, "Localizarea nu mai este activă"
        if paused:
            last_progress_at = time.monotonic()
            await asyncio.sleep(0.10)
            continue
        pose_age = time.time() - pose_at if pose_at else math.inf
        if pose_age > NAV_POSE_MAX_AGE:
            return False, "Poziția de localizare nu mai este proaspătă"
        distance = math.hypot(point[0] - pose["x"], point[1] - pose["y"])
        set_navigation_status(
            node,
            "following",
            f"Urmăresc waypoint-ul {waypoint_index}/{waypoint_count}",
            waypoint=waypoint_index,
            waypoints=waypoint_count,
            remaining=round(distance, 3),
        )
        if distance <= tolerance:
            return True, ""
        if distance < best_distance - 0.03:
            best_distance = distance
            last_progress_at = time.monotonic()
        elif time.monotonic() - last_progress_at > NAV_PROGRESS_TIMEOUT:
            return False, f"Robotul nu a progresat spre waypoint timp de {NAV_PROGRESS_TIMEOUT:.0f}s"
        await asyncio.sleep(0.10)


async def follow_planned_route(
    node: RosBridge,
    waypoints: list[tuple[float, float]],
    final_yaw: float,
    speed: float,
) -> None:
    """Execută waypoint-urile A*; primul waypoint este expediat de endpoint."""
    global navigation_task
    waypoint_count = len(waypoints) - 1
    try:
        for index in range(1, len(waypoints)):
            tolerance = (
                NAV_FINAL_TOLERANCE if index == len(waypoints) - 1
                else NAV_INTERMEDIATE_TOLERANCE
            )
            reached, error = await wait_for_navigation_waypoint(
                node, waypoints[index], tolerance, index, waypoint_count
            )
            if not reached:
                with node.lock:
                    cancelled = node.navigation_cancel_requested
                if not cancelled:
                    await command(1201, {"data": {}}, timeout=6.0)
                    set_navigation_status(node, "failed", error)
                return
            if index == len(waypoints) - 1:
                set_navigation_status(
                    node,
                    "completed",
                    "Ruta A* a fost parcursă până la destinație",
                    waypoint=waypoint_count,
                    waypoints=waypoint_count,
                    remaining=0.0,
                )
                return

            next_point = waypoints[index + 1]
            next_yaw = (
                final_yaw if index + 1 == len(waypoints) - 1
                else math.atan2(
                    waypoints[index + 2][1] - next_point[1],
                    waypoints[index + 2][0] - next_point[0],
                )
            )
            set_navigation_status(
                node,
                "dispatching",
                f"Trimit waypoint-ul {index + 1}/{waypoint_count}",
                waypoint=index + 1,
                waypoints=waypoint_count,
            )
            result = await dispatch_navigation_waypoint(next_point, next_yaw, speed)
            if not result.get("success"):
                await command(1201, {"data": {}}, timeout=6.0)
                set_navigation_status(
                    node,
                    "failed",
                    result.get("error", "Waypoint respins de API 1102"),
                )
                return
    except asyncio.CancelledError:
        set_navigation_status(node, "cancelled", "Executorul rutei a fost oprit")
        raise
    except Exception as exc:
        await command(1201, {"data": {}}, timeout=6.0)
        set_navigation_status(node, "failed", f"Executor rută: {exc}")
    finally:
        navigation_task = None


async def read_robot_fsm() -> dict[str, Any]:
    """Citește starea reală; un ACK la 7101 nu dovedește schimbarea FSM."""
    result = await command(7001, {}, timeout=3.0, service="sport")
    if not result.get("success"):
        return result
    fsm_id = fsm_id_from_result(result)
    if fsm_id is None:
        return {
            "success": False,
            "error": "API 7001 a răspuns, dar nu conține un FSM valid",
            "response": result.get("response"),
        }
    node = ros()
    with node.lock:
        node.robot_fsm = fsm_id
        reported_mode = (
            "damp" if fsm_id == 1
            else "ready" if fsm_id == 4
            else "run" if fsm_id in {500, 501, 502, 801, 802}
            else None
        )
        if reported_mode:
            node.robot_mode = reported_mode
    return {**result, "fsm_id": fsm_id}


async def wait_robot_fsm(
    expected: set[int], timeout: float = 7.0
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last: dict[str, Any] = {"success": False, "error": "FSM necitit"}
    while time.monotonic() < deadline:
        last = await read_robot_fsm()
        if last.get("success") and last.get("fsm_id") in expected:
            return last
        await asyncio.sleep(0.25)
    actual = last.get("fsm_id")
    return {
        "success": False,
        "fsm_id": actual,
        "error": (
            f"Robotul nu a confirmat FSM-ul cerut {sorted(expected)}; "
            f"FSM actual: {actual if actual is not None else 'necunoscut'}"
        ),
        "last_read": last,
    }


async def set_and_confirm_fsm(
    requested: int, expected: set[int], timeout: float = 7.0
) -> dict[str, Any]:
    sent = await command(
        7101, {"data": requested}, timeout=8.0, service="sport"
    )
    if not sent.get("success"):
        return sent
    confirmed = await wait_robot_fsm(expected, timeout)
    if not confirmed.get("success"):
        return {**confirmed, "set_response": sent}
    return {
        "success": True,
        "fsm_id": confirmed["fsm_id"],
        "set_response": sent,
        "read_response": confirmed.get("response"),
    }


async def activate_run_mode() -> dict[str, Any]:
    """Activează RUN prin controllerul acceptat de firmware și îl verifică."""
    current = await read_robot_fsm()
    if not current.get("success"):
        return current
    initial_fsm = int(current["fsm_id"])

    # Firmware-ul acestui G1 folosește uzual serviciul intern `ai`, unde
    # WALKRUN este 801/802. Dacă este deja acolo, schimbăm numai profilul.
    if initial_fsm in {801, 802}:
        speed = await command(
            7107, {"data": RUN_SPEED_MODE}, timeout=5.0, service="sport"
        )
        if not speed.get("success"):
            return speed
        return {"success": True, "fsm_id": initial_fsm, "control": "internal_ai"}

    # Nu sărim direct din Damp/Sit/Squat în locomotion. FSM 4 trebuie să fie
    # confirmat fizic înainte de transferul controlului.
    if initial_fsm not in {4, 500, 501, 502}:
        ready = await set_and_confirm_fsm(4, {4}, timeout=9.0)
        if not ready.get("success"):
            return {
                **ready,
                "error": f"Tranziția intermediară READY a eșuat: {ready.get('error', '')}",
            }

    # Calea firmware-ului `ai`: WALKRUN intern, apoi profilul RUN.
    internal_control = await command(
        7111, {"data": 2}, timeout=5.0, service="sport"
    )
    internal_fsm: dict[str, Any] = {"success": False}
    if internal_control.get("success"):
        internal_fsm = await set_and_confirm_fsm(801, {801, 802}, timeout=7.0)
        if internal_fsm.get("success"):
            speed = await command(
                7107, {"data": RUN_SPEED_MODE}, timeout=5.0, service="sport"
            )
            if speed.get("success"):
                return {
                    "success": True,
                    "fsm_id": internal_fsm["fsm_id"],
                    "control": "internal_ai",
                }

    # Fallback oficial G1 pentru serviciul `normal`: UserCtrl + Regular Mode.
    external_control = await command(
        7110, {"data": False}, timeout=5.0, service="sport"
    )
    if external_control.get("success"):
        external_fsm = await set_and_confirm_fsm(500, {500, 501, 502}, timeout=7.0)
        if external_fsm.get("success"):
            speed = await command(
                7107, {"data": RUN_SPEED_MODE}, timeout=5.0, service="sport"
            )
            if speed.get("success"):
                return {
                    "success": True,
                    "fsm_id": external_fsm["fsm_id"],
                    "control": "external_user",
                }
    else:
        external_fsm = {"success": False, "error": external_control.get("error")}

    final_state = await read_robot_fsm()
    return {
        "success": False,
        "fsm_id": final_state.get("fsm_id"),
        "error": (
            "Run nu a fost confirmat de robot. "
            f"Calea internă: {internal_fsm.get('error', internal_control.get('error', 'respinsă'))}; "
            f"calea externă: {external_fsm.get('error', 'respinsă')}"
        ),
        "internal_control": internal_control,
        "external_control": external_control,
    }


async def wait_localization_streams(
    node: RosBridge, sent_at: float, timeout: float = 10.0
) -> tuple[bool, bool]:
    deadline = time.monotonic() + timeout
    pose_ready = cloud_ready = False
    while time.monotonic() < deadline:
        with node.lock:
            pose_ready = node.pose_source == "localization" and node.pose_at >= sent_at
            cloud_ready = node.cloud_source == "localization" and node.cloud_at >= sent_at
        if pose_ready:
            break
        await asyncio.sleep(0.1)
    return pose_ready, cloud_ready


@app.get("/")
async def index(request: HttpRequest):
    # Accesarea adresei simple sincronizeaza browserul cu tokenul procesului
    # v5 curent si inlocuieste automat orice token vechi din sessionStorage.
    if TOKEN and request.query_params.get("token") != TOKEN:
        return RedirectResponse(url=f"/?token={TOKEN}", status_code=307)
    return FileResponse(FRONTEND / "index.html")


@app.get("/api/status")
async def status():
    return {"success": True, **ros().state()}


@app.get("/api/map/points")
async def map_points(limit: int = Query(default=40000, ge=1000, le=100000)):
    node = ros()
    return {
        "success": True,
        "revision": node.state()["map_revision"],
        "points": node.points(limit),
    }


@app.get("/api/map/scan2d")
async def map_scan2d(limit: int = Query(default=70000, ge=1000, le=100000)):
    node = ros()
    state = node.state()
    return {
        "success": True,
        "revision": state["scan2d_revision"],
        "total": state["scan2d_point_count"],
        "points": node.scan2d_points(limit),
    }


@app.post("/api/slam/start_mapping")
async def start_mapping(
    x_dashboard_token: str = Header(default=""),
):
    authorize(x_dashboard_token)
    node = ros()
    cancel_navigation_tracking(node, "Cartografierea a înlocuit ruta activă")
    node.clear_map()
    now = time.time()
    with node.lock:
        cloud_ready = bool(node.raw_lidar_at and now - node.raw_lidar_at < 2.0)
        odom_ready = bool(node.base_odom_at and now - node.base_odom_at < 2.0)
        if not (cloud_ready and odom_ready):
            return {
                "success": False,
                "error": (
                    "Cartografierea cere cadre proaspete pe "
                    "/utlidar/cloud_livox_mid360 și /state_estimator/odom_pelvis"
                ),
                "cloud_ready": cloud_ready,
                "odom_ready": odom_ready,
            }
        node.mode = "mapping"
        node.mapping_origin = dict(node.base_odom_pose)
        node.pose = {"x": 0.0, "y": 0.0, "yaw": 0.0}
        node.pose_source = "odom_pelvis"
        node.pose_at = now
        node.session_dir = None
        node.snapshot_index = 0
        node.last_snapshot = None
        node.pending_route = None
        node.mapping_paused = False
        node.mapping_backend = "ros2_mid360_odom"
    session = create_mapping_session()
    with node.lock:
        node.session_dir = session
    native_request_id = None
    if node.request_publisher.get_subscription_count() > 0:
        native_request_id = node.send_request(
            1801, {"data": {"slam_type": "indoor"}}
        )
    return {
        "success": True,
        "message": f"Cartografiere 3D+XY pornită. Folder sesiune: {session.name}",
        "cloud_ready": cloud_ready,
        "odom_ready": odom_ready,
        "mapping_backend": "ros2_mid360_odom",
        "native_start_requested": native_request_id is not None,
        "native_request_id": native_request_id,
        "topics": [
            "/utlidar/cloud_livox_mid360",
            "/state_estimator/odom_pelvis",
        ],
        "partial_maps": str(session),
    }


@app.post("/api/slam/pause_mapping")
async def pause_mapping(x_dashboard_token: str = Header(default="")):
    authorize(x_dashboard_token)
    node = ros()
    with node.lock:
        if node.mode != "mapping":
            return {"success": False, "error": "Nu există o sesiune de cartografiere activă"}
        node.mapping_paused = not node.mapping_paused
        paused = node.mapping_paused
    return {
        "success": True,
        "paused": paused,
        "message": "Cartografiere pusă pe pauză" if paused else "Cartografiere reluată",
    }


@app.post("/api/slam/stop_mapping")
async def stop_mapping(x_dashboard_token: str = Header(default="")):
    authorize(x_dashboard_token)
    node = ros()
    with node.lock:
        if node.mode != "mapping":
            return {"success": False, "error": "Nu există o sesiune de cartografiere activă"}
        backend = node.mapping_backend
        session = node.session_dir
    points = node.points()
    scan2d = node.scan2d_points()
    checkpoint = None
    if session is not None and points:
        checkpoint = session / f'stopped_{time.strftime("%Y%m%d_%H%M%S")}.pcd'
        await asyncio.to_thread(write_pcd_atomic, checkpoint, points)
        if scan2d:
            scan_checkpoint = session / "maps_2d" / f"stopped_{time.strftime('%Y%m%d_%H%M%S')}_2d.pcd"
            await asyncio.to_thread(write_pcd_atomic, scan_checkpoint, scan2d)

    native_result = None
    if backend == "ros2_mid360_odom":
        native_target = f'/home/unitree/.g1_v5_stopped_{int(time.time() * 1000)}.pcd'
        native_result = await command(
            1802, {"data": {"address": native_target}}, timeout=10.0
        )

    with node.lock:
        node.mode = "idle"
        node.mapping_backend = "none"
        node.mapping_paused = False
        node.session_dir = None
    native_confirmed = native_result is None or native_result.get("success", False)
    message = "Cartografiere oprită; capturile parțiale au fost păstrate"
    if native_result is not None and not native_confirmed:
        message += "; API 1802 nu a confirmat oprirea serviciului nativ"
    return {
        "success": True,
        "message": message,
        "points": len(points),
        "checkpoint": str(checkpoint) if checkpoint else None,
        "native_stop_confirmed": native_confirmed,
        "native": native_result,
    }


@app.post("/api/slam/save_map")
async def save_map(body: dict = Body(...), x_dashboard_token: str = Header(default="")):
    authorize(x_dashboard_token)
    node = ros()
    if node.mode != "mapping":
        return {"success": False, "error": "Nu exista o sesiune de mapping activa"}
    try:
        name = safe_name(body.get("name", "map"))
    except ValueError as exc:
        return {"success": False, "error": str(exc)}
    target = MAPS / f"{name}.pcd"
    target_2d = MAPS_2D / f"{name}.pcd"
    with node.lock:
        session = node.session_dir
    points = node.points()
    scan2d = node.scan2d_points()
    if not points:
        return {"success": False, "error": "Norul SLAM este gol; harta nu a fost salvată"}
    if not scan2d:
        return {
            "success": False,
            "error": (
                "Harta 2D este goală; verifică Mid360 și odometria pelvisului"
            ),
        }
    await asyncio.to_thread(write_pcd_atomic, target_2d, scan2d)
    # Procesul SLAM poate rula pe alt controler/container. Calea nativa este
    # pastrata separat de copia locala folosita de dashboard.
    native_target = f"/home/unitree/.g1_v5_{name}_{int(time.time() * 1000)}.pcd"
    result = await command(1802, {"data": {"address": native_target}}, timeout=15.0)
    # Copia locala este exact norul afisat in UI si exista independent de
    # filesystemul serviciului nativ.
    await asyncio.to_thread(write_pcd_atomic, target, points)
    if not result["success"]:
        checkpoint = None
        if session:
            checkpoint = session / f"checkpoint_{name}.pcd"
            await asyncio.to_thread(write_pcd_atomic, checkpoint, points)
        return {
            "success": False,
            "error": result.get("error", "1802 nu a confirmat copia nativa"),
            "local_saved": True,
            "mapping_continues": True,
            "map": str(target),
            "map_2d": str(target_2d),
            "points": len(points),
            "points_2d": len(scan2d),
            "checkpoint": str(checkpoint) if checkpoint else None,
            "native": result,
        }
    await asyncio.to_thread(remember_native_map, target.name, native_target)
    with node.lock:
        node.mode = "idle"
        node.session_dir = None
        node.mapping_backend = "none"
        node.mapping_paused = False
    final_partial = session / f"final_{name}.pcd" if session else None
    if final_partial:
        await asyncio.to_thread(write_pcd_atomic, final_partial, points)
        await asyncio.to_thread(
            write_pcd_atomic,
            session / "maps_2d" / f"final_{name}_2d.pcd",
            scan2d,
        )
    return {
        "success": True,
        "map": str(target),
        "map_2d": str(target_2d),
        "native_map": native_target,
        "points": len(points),
        "points_2d": len(scan2d),
        "final_partial": str(final_partial) if final_partial else None,
        "native": result,
    }


@app.get("/api/maps")
async def list_maps():
    native_paths = native_map_paths()
    maps = []
    for path in sorted(MAPS.glob("*.pcd"), key=lambda p: p.stat().st_mtime, reverse=True):
        maps.append({
            "name": path.stem,
            "file": path.name,
            "size": path.stat().st_size,
            "modified": path.stat().st_mtime,
            "native_ready": path.name in native_paths,
        })
    sessions = []
    for directory in sorted(PARTIAL_MAPS.glob("mapping_*"), reverse=True):
        snapshots = sorted(directory.glob("*.pcd"))
        sessions.append({"name": directory.name, "snapshots": len(snapshots), "path": str(directory)})
    return {"success": True, "maps": maps, "partial_sessions": sessions}


def partial_session(name: str) -> Path:
    try:
        clean = safe_name(name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not clean.startswith("mapping_"):
        raise HTTPException(400, "Nume de sesiune parțială invalid")
    path = PARTIAL_MAPS / clean
    if not path.is_dir():
        raise HTTPException(404, f"Sesiunea nu există: {clean}")
    return path


def partial_snapshot(session: str, snapshot: str) -> Path:
    directory = partial_session(session)
    try:
        clean = safe_name(snapshot)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    path = directory / f"{clean}.pcd"
    if not path.is_file():
        raise HTTPException(404, f"Captura nu există: {path.name}")
    return path


@app.get("/api/partial-maps/{session}")
async def list_partial_snapshots(session: str):
    directory = partial_session(session)
    snapshots = sorted(directory.glob("*.pcd"), key=lambda path: path.stat().st_mtime)
    return {
        "success": True,
        "session": directory.name,
        "snapshots": [
            {"name": path.stem, "file": path.name, "size": path.stat().st_size}
            for path in snapshots
        ],
    }


@app.get("/api/partial-maps/{session}/{snapshot}/points")
async def partial_snapshot_points(
    session: str, snapshot: str,
    limit: int = Query(default=50000, ge=1000, le=100000),
):
    path = partial_snapshot(session, snapshot)
    try:
        points = await asyncio.to_thread(read_pcd, path)
    except Exception as exc:
        raise HTTPException(422, f"PCD invalid: {exc}") from exc
    total = len(points)
    if total > limit:
        points = points[::math.ceil(total / limit)]
    return {
        "success": True,
        "session": session,
        "name": path.stem,
        "total": total,
        "points": points,
    }


@app.get("/api/partial-maps/{session}/{snapshot}/scan2d")
async def partial_snapshot_scan2d(
    session: str, snapshot: str,
    limit: int = Query(default=70000, ge=1000, le=100000),
):
    source = partial_snapshot(session, snapshot)
    planar = source.parent / "maps_2d" / f"{source.stem}_2d.pcd"
    try:
        if planar.is_file():
            points = await asyncio.to_thread(read_pcd, planar)
            source_kind = "proiecție XY din harta 3D stabilizată"
        else:
            cloud = await asyncio.to_thread(read_pcd, source)
            points = await asyncio.to_thread(flatten_cloud_xy, cloud)
            source_kind = "proiecție PCD veche"
    except Exception as exc:
        raise HTTPException(422, f"PCD 2D invalid: {exc}") from exc
    total = len(points)
    if total > limit:
        points = points[::math.ceil(total / limit)]
    return {
        "success": True,
        "session": session,
        "name": source.stem,
        "total": total,
        "source": source_kind,
        "points": points,
    }


@app.get("/api/partial-maps/{session}/{snapshot}/file")
async def download_partial_snapshot(session: str, snapshot: str):
    path = partial_snapshot(session, snapshot)
    return FileResponse(path, media_type="application/octet-stream", filename=path.name)


def local_map(name: str) -> Path:
    try:
        path = MAPS / f"{safe_name(name)}.pcd"
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not path.is_file():
        raise HTTPException(404, f"Harta nu exista: {path.name}")
    return path


@app.get("/api/maps/{name}/points")
async def saved_map_points(
    name: str, limit: int = Query(default=50000, ge=1000, le=100000)
):
    path = local_map(name)
    try:
        points = await asyncio.to_thread(read_pcd, path)
    except Exception as exc:
        raise HTTPException(422, f"PCD invalid: {exc}") from exc
    total = len(points)
    if total > limit:
        points = points[::math.ceil(total / limit)]
    return {"success": True, "name": path.stem, "total": total, "points": points}


@app.get("/api/maps/{name}/scan2d")
async def saved_map_scan2d(
    name: str, limit: int = Query(default=70000, ge=1000, le=100000)
):
    source = local_map(name)
    planar = MAPS_2D / source.name
    try:
        if planar.is_file():
            points = await asyncio.to_thread(read_pcd, planar)
            source_kind = "proiecție XY din harta 3D stabilizată"
        else:
            cloud = await asyncio.to_thread(read_pcd, source)
            points = await asyncio.to_thread(flatten_cloud_xy, cloud)
            source_kind = "proiecție PCD veche"
    except Exception as exc:
        raise HTTPException(422, f"PCD 2D invalid: {exc}") from exc
    total = len(points)
    if total > limit:
        points = points[::math.ceil(total / limit)]
    return {
        "success": True,
        "name": source.stem,
        "total": total,
        "source": source_kind,
        "points": points,
    }


@app.get("/api/maps/{name}/file")
async def download_saved_map(name: str):
    path = local_map(name)
    return FileResponse(path, media_type="application/octet-stream", filename=path.name)


@app.post("/api/localization/start")
async def start_localization(body: dict = Body(...), x_dashboard_token: str = Header(default="")):
    authorize(x_dashboard_token)
    node = ros()
    cancel_navigation_tracking(node, "O localizare nouă a înlocuit ruta activă")
    try:
        name = safe_name(body.get("map", ""))
        x = float(body.get("x", 0.0))
        y = float(body.get("y", 0.0))
        yaw = float(body.get("yaw", 0.0))
    except (ValueError, TypeError) as exc:
        return {"success": False, "error": f"Date de localizare invalide: {exc}"}
    path = MAPS / f"{name}.pcd"
    if not path.is_file():
        return {"success": False, "error": f"Harta nu exista: {path.name}"}
    try:
        points = await asyncio.to_thread(read_pcd, path)
    except Exception as exc:
        return {"success": False, "error": f"PCD invalid: {exc}"}
    registered_paths = native_map_paths()
    if path.name not in registered_paths:
        return {
            "success": False,
            "error": "Harta are numai copia locala pentru vizualizare; 1802 nu a confirmat copia nativa necesara lui 1804",
        }
    with node.lock:
        node.mode = "localization"
        node.pose = {"x": x, "y": y, "yaw": yaw}
        node.pose_source = "initial"
        node.pose_at = time.time()
        node.session_dir = None
        node.pending_route = None
    node.set_loaded_map(points)
    native_path = registered_paths[path.name]
    sent_at = time.time()
    result = await command(1804, {
        "data": {
            "x": x, "y": y, "z": 0.0,
            "q_x": 0.0, "q_y": 0.0,
            "q_z": math.sin(yaw / 2.0), "q_w": math.cos(yaw / 2.0),
            "address": native_path,
        }
    }, timeout=10.0)
    if not result["success"]:
        with node.lock:
            node.mode = "idle"
        return result
    pose_ready, cloud_ready = await wait_localization_streams(node, sent_at)
    if not pose_ready:
        with node.lock:
            node.mode = "idle"
        return {
            "success": False,
            "error": "API 1804 a acceptat harta, dar pozitia de localizare nu a aparut in 10s",
            "cloud_ready": cloud_ready,
            "response": result.get("response"),
        }
    return {
        "success": True,
        "message": "Localizare confirmata prin API 1804 si pozitie ROS proaspata",
        "map": str(path),
        "native_map": native_path,
        "points": len(points),
        "cloud_ready": cloud_ready,
        "response": result.get("response"),
    }


@app.post("/api/navigation/preview")
async def navigation_preview(
    body: dict = Body(...), x_dashboard_token: str = Header(default="")
):
    authorize(x_dashboard_token)
    node = ros()
    global navigation_task
    if navigation_task and not navigation_task.done():
        return {"success": False, "error": "Există deja o rută în execuție; oprește-o înainte de recalculare"}
    try:
        x = float(body["x"])
        y = float(body["y"])
        yaw = float(body.get("yaw", 0.0))
        speed = min(0.6, max(0.05, float(body.get("speed", 0.2))))
        if not all(math.isfinite(value) for value in (x, y, yaw, speed)):
            raise ValueError("valorile trebuie să fie finite")
    except (KeyError, TypeError, ValueError) as exc:
        return {"success": False, "error": f"Țintă invalidă: {exc}"}
    map_name = str(body.get("map") or "").strip()
    if map_name:
        try:
            path = MAPS / f"{safe_name(map_name)}.pcd"
        except ValueError as exc:
            return {"success": False, "error": str(exc)}
        if not path.is_file():
            return {"success": False, "error": f"Harta nu există: {path.name}"}
        try:
            planar = MAPS_2D / path.name
            if planar.is_file():
                points = await asyncio.to_thread(read_pcd, planar)
            else:
                cloud = await asyncio.to_thread(read_pcd, path)
                points = await asyncio.to_thread(flatten_cloud_xy, cloud)
        except (OSError, ValueError) as exc:
            return {"success": False, "error": f"PCD invalid: {exc}"}
    else:
        points = node.scan2d_points()
    if not points:
        return {"success": False, "error": "Nu există o hartă încărcată pentru planificare"}
    with node.lock:
        start = (float(node.pose["x"]), float(node.pose["y"]))
    try:
        route = await asyncio.to_thread(plan_xy_route, points, start, (x, y))
    except ValueError as exc:
        return {"success": False, "error": str(exc)}
    preview_id = secrets.token_urlsafe(12)
    with node.lock:
        node.pending_route = {
            "id": preview_id,
            "x": x, "y": y, "yaw": yaw, "speed": speed,
            "map": map_name,
            "start_x": start[0], "start_y": start[1],
            "expires_at": time.monotonic() + 120.0,
            "route": route,
        }
        node.navigation_status = {
            "state": "previewed",
            "message": "Ruta A* este pregătită pentru confirmare",
            "waypoint": 0,
            "waypoints": 0,
            "remaining": route["distance"],
        }
    return {
        "success": True,
        "message": "Ruta este doar previzualizată; robotul nu a primit nicio comandă de mers",
        "preview_id": preview_id,
        "start": {"x": start[0], "y": start[1]},
        "goal": {"x": x, "y": y, "yaw": yaw, "speed": speed},
        "route": route,
        "expires_in": 120,
    }


@app.post("/api/navigation/goal")
async def navigation_goal(body: dict = Body(...), x_dashboard_token: str = Header(default="")):
    global navigation_task
    authorize(x_dashboard_token)
    node = ros()
    if node.mode != "localization":
        return {"success": False, "error": "Porneste mai intai localizarea pe o harta"}
    try:
        x = float(body["x"])
        y = float(body["y"])
        yaw = float(body.get("yaw", 0.0))
        speed = min(0.6, max(0.05, float(body.get("speed", 0.2))))
    except (KeyError, TypeError, ValueError) as exc:
        return {"success": False, "error": f"Tinta invalida: {exc}"}
    pose_age = node.state()["pose_age"]
    if pose_age is None or pose_age > 2.0:
        return {"success": False, "error": "Odometria de localizare nu este proaspata"}
    preview_id = str(body.get("preview_id") or "")
    map_name = str(body.get("map") or "").strip()
    with node.lock:
        preview = dict(node.pending_route) if node.pending_route else None
        current_x = float(node.pose["x"])
        current_y = float(node.pose["y"])
        valid_preview = bool(
            preview
            and secrets.compare_digest(preview_id, str(preview["id"]))
            and time.monotonic() <= float(preview["expires_at"])
            and abs(x - float(preview["x"])) < 1e-6
            and abs(y - float(preview["y"])) < 1e-6
            and abs(yaw - float(preview["yaw"])) < 1e-6
            and abs(speed - float(preview["speed"])) < 1e-6
            and secrets.compare_digest(map_name, str(preview["map"]))
            and math.hypot(
                current_x - float(preview["start_x"]),
                current_y - float(preview["start_y"]),
            ) <= 0.25
        )
        if valid_preview:
            node.pending_route = None
    if not valid_preview:
        return {
            "success": False,
            "error": "Ruta trebuie previzualizată din nou și confirmată fără modificarea țintei",
        }
    if navigation_task and not navigation_task.done():
        return {"success": False, "error": "Există deja o rută în execuție"}
    try:
        waypoints = execution_waypoints(preview["route"]["points"])
    except (KeyError, TypeError, ValueError) as exc:
        return {"success": False, "error": f"Ruta previzualizată nu poate fi executată: {exc}"}
    first_point = waypoints[1]
    first_yaw = (
        yaw if len(waypoints) == 2
        else math.atan2(waypoints[2][1] - first_point[1], waypoints[2][0] - first_point[0])
    )
    with node.lock:
        node.navigation_cancel_requested = False
        node.navigation_paused = False
    set_navigation_status(
        node,
        "dispatching",
        f"Trimit waypoint-ul 1/{len(waypoints) - 1}",
        waypoint=1,
        waypoints=len(waypoints) - 1,
        remaining=None,
    )
    run_ready = await enforce_run_profile()
    if not run_ready.get("success"):
        set_navigation_status(node, "failed", run_ready.get("error", "RUN indisponibil"))
        return run_ready
    result = await dispatch_navigation_waypoint(first_point, first_yaw, speed)
    if not result.get("success"):
        await command(1201, {"data": {}}, timeout=6.0)
        set_navigation_status(
            node, "failed", result.get("error", "Primul waypoint a fost respins")
        )
        return result
    navigation_task = asyncio.create_task(
        follow_planned_route(node, waypoints, yaw, speed)
    )
    return {
        **result,
        "message": f"Ruta A* este executată prin {len(waypoints) - 1} waypoint-uri",
        "goal": {"x": x, "y": y, "yaw": yaw, "speed": speed},
        "waypoints": len(waypoints) - 1,
    }


@app.post("/api/navigation/pause")
async def pause_navigation(x_dashboard_token: str = Header(default="")):
    authorize(x_dashboard_token)
    node = ros()
    result = await command(1201, {"data": {}}, timeout=6.0)
    if result.get("success"):
        with node.lock:
            node.navigation_paused = True
        set_navigation_status(node, "paused", "Ruta este în pauză")
    return result


@app.post("/api/navigation/resume")
async def resume_navigation(x_dashboard_token: str = Header(default="")):
    authorize(x_dashboard_token)
    node = ros()
    result = await command(1202, {"data": {}}, timeout=6.0)
    if result.get("success"):
        run_profile = await enforce_run_profile()
        if not run_profile.get("success"):
            await command(1201, {"data": {}}, timeout=6.0)
            set_navigation_status(
                node, "paused", "Ruta a rămas în pauză: profilul RUN nu a fost acceptat"
            )
            return run_profile
        with node.lock:
            node.navigation_paused = False
        set_navigation_status(node, "following", "Execuția rutei a fost reluată")
    return result


@app.post("/api/robot/mode")
async def set_robot_mode(
    body: dict = Body(...), x_dashboard_token: str = Header(default="")
):
    authorize(x_dashboard_token)
    mode = str(body.get("mode") or "").strip().lower()
    password = str(body.get("password") or "")
    fsm_by_mode = {"damp": 1, "ready": 4, "run": None}
    if mode not in fsm_by_mode:
        raise HTTPException(400, "Mod invalid; folosește damp, ready sau run")
    if not secrets.compare_digest(password, "123"):
        raise HTTPException(403, "Parolă incorectă pentru schimbarea modului")
    node = ros()
    cancel_navigation_tracking(node, "Schimbarea modului robotului a anulat ruta")
    async with ROBOT_MODE_LOCK:
        if mode == "run":
            result = await activate_run_mode()
        else:
            requested = int(fsm_by_mode[mode])
            result = await set_and_confirm_fsm(requested, {requested}, timeout=9.0)
        if result.get("success"):
            with node.lock:
                node.robot_mode = mode
                node.robot_fsm = int(result["fsm_id"])
    return {
        **result,
        "mode": mode if result.get("success") else node.state()["robot_mode"],
        "fsm": result.get("fsm_id"),
        "message": (
            f"Mod {mode.upper()} confirmat de robot în FSM {result.get('fsm_id')}"
            if result.get("success") else result.get("error")
        ),
    }


@app.post("/api/map/clear")
async def clear_map(x_dashboard_token: str = Header(default="")):
    authorize(x_dashboard_token)
    ros().clear_map()
    return {"success": True}
