#!/usr/bin/env python3
"""Dashboard G1 Nav2 v4: SLAM Unitree, navigație Nav2 și adaptor ROS 2.

Procesul nu importa unitree_sdk2py. Astfel rclpy poate folosi CycloneDDS din
ROS Humble fara sa incarce in acelasi proces biblioteca DDS livrata de SDK.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import pty
import secrets
import signal
import subprocess
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

from pcd_io import read_pcd, write_pcd_atomic
from nav2_runtime import Nav2Runtime
from motion_adapter import (
    DEFAULT_LIMITS as UNITREE_VELOCITY_LIMITS,
    DEFAULT_TRANSFORM as UNITREE_BODY_TRANSFORM,
    ros_twist_to_unitree,
)

import rclpy
from fastapi import Body, FastAPI, Header, HTTPException, Query, Request as HttpRequest
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from nav_msgs.msg import Odometry
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import ExternalShutdownException, MultiThreadedExecutor
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from rclpy.signals import SignalHandlerOptions
from sensor_msgs.msg import PointCloud2
from sensor_msgs_py import point_cloud2
from std_msgs.msg import String
from unitree_api.msg import Request, Response
import car_integration
from camera_stream import camera
from semantic_chair_mapper import (
    LidarCameraCalibration,
    SemanticChairTracker,
    deduplicate_chair_detections,
    extract_livox_points,
)


ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
MAPS = ROOT / "maps"
MAPS_2D = MAPS / "maps_2d"
PARTIAL_MAPS = MAPS / "partial_maps"
NATIVE_MAP_REGISTRY = MAPS / ".native_paths.json"
CALIBRATION_DIR = ROOT / "lidar_camera_calibration"
TOKEN = os.environ.get("G1_DASHBOARD_TOKEN", "")
VOXEL_SIZE = float(os.environ.get("G1_MAP_VOXEL_SIZE", "0.05"))
MAX_POINTS = int(os.environ.get("G1_MAP_MAX_POINTS", "350000"))
SNAPSHOT_INTERVAL_SECONDS = 5.0
RUN_SPEED_MODE = 1
DIRECT_CONTROL_FSMS = frozenset({500, 501, 502})
INTERNAL_CONTROL_FSMS = frozenset({801, 802, 812})
LOCOMOTION_FSMS = DIRECT_CONTROL_FSMS | INTERNAL_CONTROL_FSMS
MUTATION_LOCK = asyncio.Lock()
MOTION_LOCK = asyncio.Lock()
POSE_MAX_AGE = 1.0
SAFE_CMD_MAX_AGE = 0.40
NAV_SAFE_CMD_MAX_AGE = 0.75
NAV_REPLAN_INPUT_GRACE = 0.20
NAV_PIPELINE_RECOVERY_GRACE = 2.00
SPORT_COMMAND_PERIOD = 0.10
SPORT_COMMAND_DURATION = 0.65
TELEOP_PROGRESS_TIMEOUT = 1.50
ACTUATION_PROBE_MIN_LINEAR = 0.08
ACTUATION_PROBE_MIN_ANGULAR = 0.25
NAV_SPEED_MIN = 0.30
NAV_SPEED_MAX = UNITREE_VELOCITY_LIMITS.forward
NAV_SPEED_DEFAULT = 0.60
NAV_ANGULAR_LIMIT = UNITREE_VELOCITY_LIMITS.angular
TELEOP_LINEAR_MIN = 0.10
TELEOP_LINEAR_MAX = UNITREE_VELOCITY_LIMITS.forward
TELEOP_LINEAR_DEFAULT = 0.50
TELEOP_ANGULAR_MIN = 0.30
TELEOP_ANGULAR_MAX = UNITREE_VELOCITY_LIMITS.angular
TELEOP_ANGULAR_DEFAULT = 1.00
TELEOP_KEYBOARD_LINEAR_BASE = 0.20
TELEOP_KEYBOARD_ANGULAR_BASE = 0.30

semantic_chair_tracker = SemanticChairTracker(
    confirmations=3, merge_distance_m=0.45, voxel_size_m=0.025,
    lifespan_s=10.0, max_voxels=10000, aging_cap=100.0,
    growth_per_observation=6.0, visible_miss_decay=9.0,
)
semantic_chair_lock = threading.Lock()
semantic_chair_map_path: Optional[str] = None
semantic_chair_last_process = 0.0
try:
    lidar_camera_calibration = LidarCameraCalibration.load(CALIBRATION_DIR)
    semantic_calibration_error = ""
except Exception as exc:
    lidar_camera_calibration = None
    semantic_calibration_error = str(exc)

def safe_name(value: str) -> str:
    original = str(value).strip()
    cleaned = "".join(c for c in original if c.isalnum() or c in "_-")
    if not cleaned or cleaned != original or len(cleaned) > 64:
        raise ValueError("Numele trebuie sa aiba 1-64 caractere: litere, cifre, _ sau -")
    return cleaned


def navigation_target(body: dict[str, Any]) -> tuple[float, float, float, float]:
    values = tuple(float(body[key]) for key in ("x", "y", "yaw", "speed"))
    if not all(math.isfinite(value) for value in values):
        raise ValueError("valorile trebuie să fie finite")
    x, y, yaw, speed = values
    if not NAV_SPEED_MIN <= speed <= NAV_SPEED_MAX:
        raise ValueError(
            f"viteza trebuie să fie între {NAV_SPEED_MIN:.2f} și {NAV_SPEED_MAX:.2f} m/s"
        )
    return x, y, yaw, speed


def teleop_speed_value(value: Any) -> float:
    speed = float(value)
    if not math.isfinite(speed) or not TELEOP_LINEAR_MIN <= speed <= TELEOP_LINEAR_MAX:
        raise ValueError(
            f"viteza teleop trebuie să fie între {TELEOP_LINEAR_MIN:.2f} "
            f"și {TELEOP_LINEAR_MAX:.2f} m/s"
        )
    return speed


def teleop_turn_speed_value(value: Any) -> float:
    speed = float(value)
    if not math.isfinite(speed) or not TELEOP_ANGULAR_MIN <= speed <= TELEOP_ANGULAR_MAX:
        raise ValueError(
            f"viteza unghiulară trebuie să fie între {TELEOP_ANGULAR_MIN:.2f} "
            f"și {TELEOP_ANGULAR_MAX:.2f} rad/s"
        )
    return speed


def teleop_velocity_command(
    velocity: tuple[float, float, float], speed: float, turn_speed: float
) -> tuple[float, float, float]:
    """Aplică o singură scalare finală la valorile alese în dashboard."""
    speed = teleop_speed_value(speed)
    turn_speed = teleop_turn_speed_value(turn_speed)
    linear_scale = speed / TELEOP_KEYBOARD_LINEAR_BASE
    angular_scale = turn_speed / TELEOP_KEYBOARD_ANGULAR_BASE
    vx = max(-speed, min(speed, velocity[0] * linear_scale))
    lateral_limit = min(speed, UNITREE_VELOCITY_LIMITS.lateral)
    vy = max(-lateral_limit, min(lateral_limit, velocity[1] * linear_scale))
    wz = max(-turn_speed, min(turn_speed, velocity[2] * angular_scale))
    return vx, vy, wz


def nav_safe_stream_state(
    safe_at: float,
    source_at: float,
    now: float,
    source_velocity: Optional[tuple[float, float, float]] = None,
) -> str:
    """Separă repausul Nav2 de o întrerupere reală a filtrului de siguranță.

    Collision Monitor încetează intenționat să repete zero după
    ``stop_pub_timeout``. O intrare Nav2 proaspătă, dar zero, nu dovedește deci
    că pipeline-ul s-a rupt; numai o intrare nenulă fără ieșire sigură este
    clasificată drept defect.
    """
    safe_fresh = safe_at > 0.0 and now - safe_at <= NAV_SAFE_CMD_MAX_AGE
    if safe_fresh:
        return "fresh"
    source_fresh = source_at > 0.0 and now - source_at <= NAV_SAFE_CMD_MAX_AGE
    source_is_zero = source_velocity is not None and not any(
        abs(float(value)) > 1e-3 for value in source_velocity
    )
    if source_fresh and source_is_zero:
        return "waiting"
    return "broken" if source_fresh else "waiting"


def command_can_verify_actuation(vx: float, vy: float, wz: float) -> bool:
    """Ignoră eșantioanele mici din rampa smoother-ului la proba de mers."""
    return (
        math.hypot(float(vx), float(vy)) >= ACTUATION_PROBE_MIN_LINEAR
        or abs(float(wz)) >= ACTUATION_PROBE_MIN_ANGULAR
    )


def locomotion_fsms_for_service(service_name: str) -> frozenset[int]:
    name = str(service_name or "").strip().lower()
    if name == "ai":
        return INTERNAL_CONTROL_FSMS
    if name == "normal":
        return DIRECT_CONTROL_FSMS
    raise ValueError(f"serviciu locomotor necunoscut: {service_name!r}")


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


def _livox_points_to_base(points: list[dict]) -> tuple[list[tuple[float, float, float]], float]:
    """Transformarea rigidă livox_frame -> base_link folosită de adaptorul v3."""
    if not points:
        return [], -0.75
    roll = 3.14
    pitch = 0.04014257279586953
    cr, sr = math.cos(roll), math.sin(roll)
    cp, sp = math.cos(pitch), math.sin(pitch)
    base_points: list[tuple[float, float, float]] = []
    ground_candidates: list[float] = []
    for point in points:
        x = float(point.get("x", 0.0))
        y = float(point.get("y", 0.0))
        z = float(point.get("z", 0.0))
        if not all(math.isfinite(value) for value in (x, y, z)):
            continue
        base_x = 0.0002835 + cp * x + sp * sr * y + sp * cr * z
        base_y = 0.00003 + cr * y - sr * z
        base_z = 0.46018 - sp * x + cp * sr * y + cp * cr * z
        base_points.append((base_x, base_y, base_z))
        horizontal = math.hypot(base_x, base_y)
        if 0.30 <= horizontal <= 3.0 and -1.8 <= base_z <= 0.30:
            ground_candidates.append(base_z)
    if not ground_candidates:
        return base_points, -0.75
    ground_candidates.sort()
    index = min(len(ground_candidates) - 1, max(0, int(len(ground_candidates) * 0.12)))
    return base_points, max(-1.45, min(-0.35, ground_candidates[index]))


def _transform_semantic_livox_points_to_map(
    points: list[dict], pose: dict
) -> list[dict]:
    """Transformă punctele RGB camera->Livox->base_link->map."""
    base_points, estimated_ground = _livox_points_to_base(points)
    current = bridge
    with current.lock if current is not None else semantic_chair_lock:
        ground_base_z = float(
            current.last_raw_lidar_ground_base_z if current is not None else estimated_ground
        )
    yaw = float(pose.get("yaw", 0.0))
    cosine, sine = math.cos(yaw), math.sin(yaw)
    pose_x, pose_y = float(pose.get("x", 0.0)), float(pose.get("y", 0.0))
    transformed = []
    for source, (base_x, base_y, base_z) in zip(points, base_points):
        relative_z = base_z - ground_base_z
        if not 0.06 <= relative_z <= 2.20:
            continue
        transformed.append({
            "x": pose_x + cosine * base_x - sine * base_y,
            "y": pose_y + sine * base_x + cosine * base_y,
            "z": relative_z,
            "r": int(source.get("r", 180)),
            "g": int(source.get("g", 180)),
            "b": int(source.get("b", 180)),
        })
    return transformed


def _transform_livox_points_to_map(points: list[dict], pose: dict) -> list[dict]:
    base_points, ground_base_z = _livox_points_to_base(points)
    yaw = float(pose.get("yaw", 0.0))
    cosine, sine = math.cos(yaw), math.sin(yaw)
    pose_x, pose_y = float(pose.get("x", 0.0)), float(pose.get("y", 0.0))
    return [
        {
            "x": pose_x + cosine * x - sine * y,
            "y": pose_y + sine * x + cosine * y,
            "z": z - ground_base_z,
        }
        for x, y, z in base_points
    ]


def _semantic_chair_payload() -> dict:
    with semantic_chair_lock:
        objects = semantic_chair_tracker.snapshot()
        map_path = semantic_chair_map_path
    return {
        "type": "semantic_chairs",
        "objects": objects,
        "count": len(objects),
        "lifespan_s": semantic_chair_tracker.lifespan_s,
        "aging_cap": semantic_chair_tracker.aging_cap,
        "map_path": map_path,
        "calibration_available": lidar_camera_calibration is not None,
        "calibration_error": semantic_calibration_error,
    }


def _reset_semantic_chairs(map_path: Optional[str] = None) -> dict:
    global semantic_chair_map_path
    with semantic_chair_lock:
        semantic_chair_tracker.reset()
        semantic_chair_map_path = map_path
    return _semantic_chair_payload()


def _semantic_context() -> Optional[tuple[str, dict]]:
    current = bridge
    if current is None:
        return None
    with current.lock:
        if current.mode != "localization" or not current.selected_map:
            return None
        if not current.pose_at or time.time() - current.pose_at > 3.0:
            return None
        pose = dict(current.pose)
        map_path = str(MAPS / f"{current.selected_map}.pcd")
    return map_path, pose


def _semantic_lidar_map_snapshot(pose: dict) -> list[dict]:
    current = bridge
    if current is None:
        return []
    with current.lock:
        observed_at = current.last_semantic_raw_lidar_time
        raw_points = list(current.last_semantic_raw_lidar_points)
    if observed_at <= 0.0 or time.monotonic() - observed_at > 0.8 or len(raw_points) < 50:
        return []
    return _transform_livox_points_to_map(raw_points, pose)


def _process_semantic_chairs(depth_img, color_img, detections: list[dict]) -> Optional[dict]:
    """Construiește și persistă obiectele chair/toilet în coordonatele hărții."""
    global semantic_chair_last_process, semantic_chair_map_path
    if lidar_camera_calibration is None:
        return None
    context = _semantic_context()
    if context is None:
        return None
    current_map, pose = context
    now = time.monotonic()
    if now - semantic_chair_last_process < 0.25:
        return None
    semantic_chair_last_process = now
    relevant = deduplicate_chair_detections(
        detections, minimum_confidence=0.35, iou_threshold=0.35,
    )
    observations = []
    for detection in relevant:
        livox_points = extract_livox_points(
            depth_img, color_img, detection, lidar_camera_calibration,
            detection_is_flipped=False,
        )
        map_points = _transform_semantic_livox_points_to_map(livox_points, pose)
        if map_points:
            observations.append({
                "points": map_points,
                "confidence": float(detection.get("confidence", 0.0)),
            })
    lidar_map_points = _semantic_lidar_map_snapshot(pose)
    with semantic_chair_lock:
        if semantic_chair_map_path != current_map:
            semantic_chair_tracker.reset()
            semantic_chair_map_path = current_map
        changed = semantic_chair_tracker.update_frame(
            observations, lidar_map_points, pose, observed_at=now,
        )
    return _semantic_chair_payload() if changed else None


async def semantic_chair_loop() -> None:
    last_frame_at = 0.0
    while True:
        await asyncio.sleep(0.05)
        if not camera.yolo_enabled():
            continue
        color_img, depth_img, detections, received_at = camera.semantic_frame()
        if not received_at or received_at == last_frame_at or color_img is None or depth_img is None:
            continue
        last_frame_at = received_at
        await asyncio.to_thread(_process_semantic_chairs, depth_img, color_img, detections)


async def semantic_chair_aging_loop() -> None:
    while True:
        await asyncio.sleep(1.0)
        with semantic_chair_lock:
            semantic_chair_tracker.expire()


async def enforce_run_profile() -> dict[str, Any]:
    result = await command(7107, {"data": RUN_SPEED_MODE}, timeout=2.0, service="sport")
    node = ros()
    with node.lock:
        node.run_profile_accepted = bool(result.get("success"))
    return result


async def prepare_navigation_run() -> dict[str, Any]:
    """Verifică serviciul/FSM și proba teleop înainte ca Nav2 să miște."""
    node = ros()
    with node.lock:
        node.run_profile_accepted = False
    service_state = await read_motion_service()
    if not service_state.get("success"):
        return service_state
    service_name = service_state["service_name"]
    expected_fsms = locomotion_fsms_for_service(service_name)
    current = await read_robot_fsm()
    if not current.get("success") or current.get("fsm_id") not in expected_fsms:
        return {
            "success": False,
            "error": (
                f"Serviciul locomotor {service_name!r} cere FSM din "
                f"{sorted(expected_fsms)}; FSM actual: {current.get('fsm_id')}"
            ),
            "fsm": current,
        }
    with node.lock:
        tested = node.teleop_verified
    if not tested:
        return {
            "success": False,
            "error": (
                "Testează mai întâi mersul din taste: activează teleoperarea, "
                "pornește teleop_twist_keyboard și confirmă mișcarea reală"
            ),
            "fsm": current,
        }
    stopped = await send_velocity(0.0, 0.0, 0.0)
    if not stopped.get("success"):
        return stopped
    profile = await enforce_run_profile()
    if not profile.get("success"):
        return profile
    return {"success": True, "fsm_id": current["fsm_id"], "run_profile_accepted": True}


class RosBridge(Node):
    def __init__(self) -> None:
        super().__init__("robot_car_g1_nav2")
        self.lock = threading.RLock()
        self.response_condition = threading.Condition(self.lock)
        self.mode = "idle"
        self.pose = {"x": 0.0, "y": 0.0, "yaw": 0.0}
        self.pose_source = "none"
        self.pose_at = 0.0
        self.cloud_at = 0.0
        self.cloud_source = "none"
        self.raw_lidar_at = 0.0
        self.last_semantic_raw_lidar_points: list[dict] = []
        self.last_semantic_raw_lidar_time = 0.0
        self.last_raw_lidar_ground_base_z = -0.75
        self.base_odom_at = 0.0
        self.base_odom_pose: Optional[dict[str, float]] = None
        self.native_mapping_cloud_at = 0.0
        self.native_mapping_odom_at = 0.0
        self.native_odom_frame = ""
        self.native_child_frame = ""
        self.map_frame = ""
        self.mapping_error = ""
        self.cloud_processing = threading.Lock()
        self.last_cloud_processed = 0.0
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
        self.last_api_response: Optional[dict[str, Any]] = None
        self.request_id = time.monotonic_ns()
        self.session_dir: Optional[Path] = None
        self.snapshot_index = 0
        self.last_snapshot: Optional[Path] = None
        self.last_snapshot_error = ""
        self.pending_route: Optional[dict[str, Any]] = None
        self.navigation_paused = False
        self.navigation_cancel_requested = False
        self.robot_mode = "unknown"
        self.run_profile_accepted = False
        self.motion_active = False
        self.motion_armed_at = 0.0
        self.navigation_speed = NAV_SPEED_DEFAULT
        self.motion_speed_limit = NAV_SPEED_DEFAULT
        self.teleop_speed = TELEOP_LINEAR_DEFAULT
        self.teleop_turn_speed = TELEOP_ANGULAR_DEFAULT
        self.last_ros_velocity = [0.0, 0.0, 0.0]
        self.last_forwarded_velocity = [0.0, 0.0, 0.0]
        self.last_forwarded_at = 0.0
        self.last_velocity_accepted = False
        self.actuation_probe_at = 0.0
        self.actuation_probe_pose: Optional[dict[str, float]] = None
        self.actuation_verified = False
        self.control_owner = "disabled"
        self.teleop_enabled = False
        self.teleop_verified = False
        self.teleop_error = ""
        self.motion_service_name = ""
        self.motion_service_form = ""
        self.motion_conflict = ""
        self.foreign_motion_at = -math.inf
        self.request_id_floor = self.request_id
        self.localization_frame = ""
        self.localization_input = ""
        self.selected_map = ""
        self.robot_fsm: Optional[int] = None
        stream_callbacks = ReentrantCallbackGroup()

        # BEST_EFFORT poate primi atât publisheri best-effort cât și reliable.
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
        self.motion_switcher_request_publisher = self.create_publisher(
            Request, "/api/motion_switcher/request", reliable_qos
        )
        self.create_subscription(
            Response, "/api/slam_operate/response", self._store_response, reliable_qos
        )
        self.create_subscription(
            Response, "/api/sport/response", self._store_response, reliable_qos
        )
        self.create_subscription(
            Response, "/api/motion_switcher/response", self._store_response, reliable_qos
        )
        self.create_subscription(
            Request, "/api/sport/request", self._on_sport_request, reliable_qos,
            callback_group=stream_callbacks,
        )
        self.create_subscription(
            Request, "/api/slam_operate/request", self._on_navigation_request, reliable_qos,
            callback_group=stream_callbacks,
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
            unitree_cloud_qos, callback_group=stream_callbacks,
        )
        self.nav2 = Nav2Runtime(self)
        self.get_logger().info(
            "nav2_v4 pornit: Nav2 planifică/urmărește; API-urile native 1102/1201/1202 sunt interzise"
        )

    def _on_sport_request(self, message: Request) -> None:
        api = int(message.header.identity.api_id)
        request_id = int(message.header.identity.id)
        with self.lock:
            ours = self.request_id_floor < request_id <= self.request_id
            if not ours and api in {7101, 7105, 7107, 7110, 7111}:
                self.foreign_motion_at = time.monotonic()
                self.teleop_verified = False
                if self.motion_active:
                    self.motion_conflict = f"Alt emitent trimite comenzi locomotion (API {api})"

    def _on_navigation_request(self, message: Request) -> None:
        api = int(message.header.identity.api_id)
        with self.lock:
            if api in {1102, 1202}:
                self.foreign_motion_at = time.monotonic()
            if self.motion_active and api in {1102, 1201, 1202, 1801, 1804, 1901}:
                self.motion_conflict = f"Alt emitent comandă navigația/SLAM (API {api})"

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
            while len(self.responses) > 128:
                self.responses.pop(next(iter(self.responses)))
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
                    self._set_localization_pose({"x": x, "y": y, "yaw": yaw}, "slam_info")

    def _set_localization_pose(self, pose: dict, source: str, frame: str = "") -> None:
        """One pose authority at a time; never mix asynchronous pose streams."""
        if not all(math.isfinite(pose[k]) for k in ("x", "y", "yaw")):
            return
        with self.lock:
            if self.localization_input and self.localization_input != source:
                if time.time()-self.pose_at <= POSE_MAX_AGE:
                    return
                if self.motion_active:
                    self.motion_conflict = "Sursa localizării s-a pierdut; oprește ruta înainte de schimbarea sursei"
                    return
                self.localization_frame = ""
            if frame and self.localization_frame and frame != self.localization_frame:
                self.motion_conflict = "Cadrul localizării s-a schimbat"
                return
            self.localization_input = source
            self.localization_frame = frame or self.localization_frame
            self.pose, self.pose_source, self.pose_at = pose, "localization", time.time()
        self.nav2.update_map_pose(pose)

    def _on_base_odom(self, message: Odometry) -> None:
        # Base odometry is telemetry, not a second map-localized pose source.
        position = message.pose.pose.position
        orientation = message.pose.pose.orientation
        pose = {
            "x": float(position.x),
            "y": float(position.y),
            "yaw": yaw_from_quaternion(
                float(orientation.x), float(orientation.y),
                float(orientation.z), float(orientation.w),
            ),
        }
        with self.lock:
            self.base_odom_at = time.time()
            self.base_odom_pose = pose
        self.nav2.update_local_odometry(message)

    def _on_raw_lidar(self, message: PointCloud2) -> None:
        now_wall = time.time()
        now_mono = time.monotonic()
        with self.lock:
            self.raw_lidar_at = now_wall
            should_sample = (
                camera.yolo_enabled()
                and self.mode == "localization"
                and now_mono - self.last_semantic_raw_lidar_time >= 0.20
            )
            if should_sample:
                self.last_semantic_raw_lidar_time = now_mono
        if not should_sample:
            return
        try:
            declared = max(1, int(message.width) * max(1, int(message.height)))
            step = max(1, declared // 2500)
            points = []
            for index, item in enumerate(point_cloud2.read_points(
                message, field_names=("x", "y", "z"), skip_nans=True
            )):
                if index % step:
                    continue
                x, y, z = (float(value) for value in item)
                if all(math.isfinite(value) for value in (x, y, z)):
                    points.append({"x": x, "y": y, "z": z})
            _, ground_base_z = _livox_points_to_base(points)
        except Exception:
            return
        with self.lock:
            self.last_semantic_raw_lidar_points = points
            self.last_semantic_raw_lidar_time = now_mono
            self.last_raw_lidar_ground_base_z = ground_base_z


    def _on_odom(self, message: Odometry, source: str, input_name: str = "") -> None:
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
            pose = {
                "x": float(position.x), "y": float(position.y),
                "yaw": yaw_from_quaternion(
                    float(orientation.x), float(orientation.y),
                    float(orientation.z), float(orientation.w),
                ),
            }
            if source == "localization":
                self._set_localization_pose(pose, input_name or "localization_odom", frame)
            elif all(math.isfinite(v) for v in pose.values()):
                self.pose, self.pose_source, self.pose_at = pose, source, now

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
        if api_id in {1102, 1201, 1202}:
            raise ValueError("Navigația nativă este dezactivată în nav2_v4")
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
                if exact and exact["api_id"] == api_id and exact["received_at"] >= sent_at:
                    return exact
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self.response_condition.wait(remaining)

    def state(self) -> dict[str, Any]:
        now = time.time()
        keyboard_status = teleop_keyboard.status()
        navigation = self.nav2.status()
        with self.lock:
            info = dict(self.slam_info)
            pose = dict(self.pose)
            odom_pose = dict(self.base_odom_pose) if self.base_odom_pose else None
            goal = navigation.get("goal") or {}
            goal_yaw = goal.get("yaw")
            yaw_error = (
                (float(goal_yaw) - float(pose["yaw"]) + math.pi) % (2.0 * math.pi) - math.pi
                if goal_yaw is not None
                else None
            )
            return {
                "mode": self.mode,
                "pose": pose,
                "pose_source": self.pose_source,
                "localization_input": self.localization_input,
                "pose_age": None if not self.pose_at else round(now - self.pose_at, 3),
                "cloud_source": self.cloud_source,
                "cloud_age": None if not self.cloud_at else round(now - self.cloud_at, 3),
                "lidar_age": None if not self.raw_lidar_at else round(now - self.raw_lidar_at, 3),
                "base_odom_age": None if not self.base_odom_at else round(now - self.base_odom_at, 3),
                "base_odom_pose": odom_pose,
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
                "navigation": navigation,
                "navigation_speed": self.navigation_speed,
                "yaw_diagnostics": {
                    "goal": goal_yaw,
                    "map_to_base_link": pose["yaw"],
                    "odom_to_base_link": odom_pose["yaw"] if odom_pose else None,
                    "goal_error": yaw_error,
                },
                "robot_mode": self.robot_mode,
                "robot_fsm": self.robot_fsm,
                "run_profile_accepted": self.run_profile_accepted,
                "motion_service": self.motion_service_name,
                "motion_service_form": self.motion_service_form,
                "navigation_executor": "nav2",
                "lidar_guard": self.nav2.health_error() or "ready",
                "lidar_obstacle_count": None,
                "lidar_nearest_body": None,
                "collision_radius": 0.46,
                "map_clearance": 0.02,
                "motion_conflict": self.motion_conflict,
                "locomotion_bridge": {
                    "topic_in": "/nav2/cmd_vel_safe",
                    "teleop_topic": "/cmd_vel_teleop",
                    "nav2_topic": "/nav2/cmd_vel_nav2",
                    "api_out": 7105,
                    "rate_hz": 1.0 / SPORT_COMMAND_PERIOD,
                    "transport": "ROS 2 unitree_api/Request (fără unitree_sdk2py)",
                    "frame_transform": UNITREE_BODY_TRANSFORM.description(),
                    "limits": {
                        "forward": UNITREE_VELOCITY_LIMITS.forward,
                        "reverse": UNITREE_VELOCITY_LIMITS.reverse,
                        "lateral": UNITREE_VELOCITY_LIMITS.lateral,
                        "angular": UNITREE_VELOCITY_LIMITS.angular,
                    },
                    "last_ros_velocity": list(self.last_ros_velocity),
                    "last_velocity": list(self.last_forwarded_velocity),
                    "last_command_age": (
                        None if not self.last_forwarded_at
                        else round(time.monotonic() - self.last_forwarded_at, 3)
                    ),
                    "last_ack": self.last_velocity_accepted,
                    "actuation_verified": self.actuation_verified,
                    "control_owner": self.control_owner,
                    "teleop_enabled": self.teleop_enabled,
                    "teleop_speed": self.teleop_speed,
                    "teleop_turn_speed": self.teleop_turn_speed,
                    "teleop_verified": self.teleop_verified,
                    "teleop_error": self.teleop_error,
                    "teleop_process_running": keyboard_status["running"],
                    "teleop_last_key": keyboard_status["last_key"],
                    "teleop_last_key_age": keyboard_status["last_key_age"],
                    "teleop_path": "direct_to_sport_with_watchdog",
                },
                "rmw": os.environ.get("RMW_IMPLEMENTATION", ""),
            }


class OdomReceiver(Node):
    """Nod usor, separat de deserializarea norilor mari de puncte."""

    def __init__(self, target: RosBridge) -> None:
        super().__init__("robot_car_g1_nav2_odom")
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
            lambda msg: target._on_odom(msg, "localization", "localization_odom"), qos,
        )
        self.create_subscription(
            Odometry, "/unitree/slam_relocation/odom",
            lambda msg: target._on_odom(msg, "localization", "relocation_odom"), qos,
        )


class TeleopKeyboardProcess:
    """Rulează teleop_twist_keyboard într-un PTY controlat de pagina web."""

    EXECUTABLE = Path("/opt/ros/humble/lib/teleop_twist_keyboard/teleop_twist_keyboard")
    # Viteza este stabilită exclusiv de sliderul dashboardului. Tastele q/z/x
    # ale teleop_twist_keyboard nu sunt acceptate, pentru a evita două reglaje.
    ALLOWED_KEYS = frozenset("uiojklm,.UIOJKLM<>") | {"k"}
    MOTION_KEYS = frozenset("uiojlm,.UIOJKLM<>")

    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.process: Optional[subprocess.Popen] = None
        self.master_fd: Optional[int] = None
        self.last_key = ""
        self.last_key_at = 0.0

    def running(self) -> bool:
        with self.lock:
            return self.process is not None and self.process.poll() is None

    def start(self) -> dict[str, Any]:
        with self.lock:
            if self.process is not None and self.process.poll() is None:
                return {"success": True, "already_running": True}
            self._close_locked()
            if not self.EXECUTABLE.is_file():
                return {
                    "success": False,
                    "error": f"teleop_twist_keyboard lipsește: {self.EXECUTABLE}",
                }
            master_fd, slave_fd = pty.openpty()
            command_line = [
                str(self.EXECUTABLE),
                "--ros-args",
                "--remap", "cmd_vel:=/cmd_vel_teleop",
                "-p", "speed:=0.20",
                "-p", "turn:=0.30",
            ]
            try:
                process = subprocess.Popen(
                    command_line,
                    stdin=slave_fd,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    env=os.environ.copy(),
                    close_fds=True,
                    start_new_session=True,
                )
            except Exception as exc:
                os.close(master_fd)
                os.close(slave_fd)
                return {"success": False, "error": f"Pornirea teleop a eșuat: {exc}"}
            finally:
                try:
                    os.close(slave_fd)
                except OSError:
                    pass
            self.process = process
            self.master_fd = master_fd
            self.last_key = ""
            self.last_key_at = 0.0
        time.sleep(0.25)
        if not self.running():
            self.stop()
            return {"success": False, "error": "teleop_twist_keyboard s-a oprit la pornire"}
        return {"success": True, "pid": process.pid}

    def send_key(self, key: str) -> dict[str, Any]:
        if key not in self.ALLOWED_KEYS:
            return {"success": False, "error": "Tastă teleop nepermisă"}
        with self.lock:
            if self.process is None or self.process.poll() is not None or self.master_fd is None:
                return {"success": False, "error": "teleop_twist_keyboard nu rulează"}
            try:
                os.write(self.master_fd, key.encode("ascii"))
            except OSError as exc:
                return {"success": False, "error": f"Terminalul teleop nu răspunde: {exc}"}
            self.last_key = key
            self.last_key_at = time.monotonic()
        return {"success": True, "key": key}

    def status(self) -> dict[str, Any]:
        with self.lock:
            return {
                "running": self.process is not None and self.process.poll() is None,
                "last_key": self.last_key,
                "last_key_age": (
                    None
                    if not self.last_key_at
                    else round(time.monotonic() - self.last_key_at, 3)
                ),
            }

    def stop(self) -> None:
        with self.lock:
            process = self.process
            master_fd = self.master_fd
            if process is not None and process.poll() is None:
                if master_fd is not None:
                    try:
                        os.write(master_fd, b"k")
                    except OSError:
                        pass
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.wait(timeout=0.8)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=0.8)
                except (OSError, ProcessLookupError):
                    pass
            self._close_locked()

    def _close_locked(self) -> None:
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
        self.master_fd = None
        self.process = None


bridge: Optional[RosBridge] = None
odom_receiver: Optional[OdomReceiver] = None
ros_thread: Optional[threading.Thread] = None
odom_thread: Optional[threading.Thread] = None
snapshot_task: Optional[asyncio.Task] = None
velocity_task: Optional[asyncio.Task] = None
semantic_task: Optional[asyncio.Task] = None
semantic_aging_task: Optional[asyncio.Task] = None
teleop_keyboard = TeleopKeyboardProcess()


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
    global bridge, odom_receiver, ros_thread, odom_thread, snapshot_task, velocity_task
    global semantic_task, semantic_aging_task
    MAPS.mkdir(parents=True, exist_ok=True)
    MAPS_2D.mkdir(parents=True, exist_ok=True)
    PARTIAL_MAPS.mkdir(parents=True, exist_ok=True)
    if os.environ.get("RMW_IMPLEMENTATION") != "rmw_cyclonedds_cpp":
        raise RuntimeError("nav2_v4 cere RMW_IMPLEMENTATION=rmw_cyclonedds_cpp")
    rclpy.init(args=[], signal_handler_options=SignalHandlerOptions.NO)
    bridge = RosBridge()
    odom_receiver = OdomReceiver(bridge)
    ros_thread = threading.Thread(target=spin_ros, args=(bridge, 4), daemon=True)
    odom_thread = threading.Thread(target=spin_ros, args=(odom_receiver, 1), daemon=True)
    ros_thread.start()
    odom_thread.start()
    snapshot_task = asyncio.create_task(snapshot_loop())
    velocity_task = asyncio.create_task(velocity_forward_loop())
    car_integration.configure(
        lambda: ros().state(),
        lambda: str(MAPS / f"{bridge.selected_map}.pcd") if bridge and bridge.selected_map else None,
    )
    camera.start()
    semantic_task = asyncio.create_task(semantic_chair_loop())
    semantic_aging_task = asyncio.create_task(semantic_chair_aging_loop())
    try:
        yield
    finally:
        for task in (semantic_task, semantic_aging_task):
            if task:
                task.cancel()
        for task in (semantic_task, semantic_aging_task):
            if task:
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        camera.stop()
        await car_integration.shutdown()
        await stop_nav2_navigation(bridge, "Dashboard închis")
        if velocity_task:
            velocity_task.cancel()
            try:
                await velocity_task
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


app = FastAPI(title="Robot + Car · G1 Nav2 v4", version="4.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(FRONTEND)), name="static")
app.include_router(car_integration.router)


@app.get("/api/health/startup")
async def startup_health():
    return {"ready": bool(bridge and rclpy.ok() and camera.ready.is_set()), "camera": camera.status()}


@app.get("/api/camera/status")
async def camera_status():
    return camera.status()


@app.get("/api/camera/{kind}")
async def camera_image(kind: str):
    from fastapi.responses import Response as HttpResponse
    frame = camera.frame(kind)
    if not frame:
        raise HTTPException(503, "Camera nu a livrat încă un cadru")
    return HttpResponse(frame, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/api/yolo/status")
async def yolo_status():
    return camera.status()


@app.get("/api/semantic/chairs")
async def get_semantic_chairs():
    return {"success": True, **_semantic_chair_payload()}


@app.delete("/api/semantic/chairs")
async def clear_semantic_chairs(x_dashboard_token: str = Header(default="")):
    authorize(x_dashboard_token)
    current = bridge
    map_path = None
    if current is not None:
        with current.lock:
            if current.selected_map:
                map_path = str(MAPS / f"{current.selected_map}.pcd")
    return {"success": True, **_reset_semantic_chairs(map_path)}


@app.post("/api/yolo/toggle")
async def toggle_yolo(body: dict = Body(default={}), x_dashboard_token: str = Header(default="")):
    authorize(x_dashboard_token)
    from camera_stream import YOLO_AVAILABLE
    if not YOLO_AVAILABLE:
        raise HTTPException(503, "ultralytics nu este instalat")
    enabled = camera.set_yolo_enabled(body.get("enabled", not camera.yolo_enabled()))
    return {"success": True, "enabled": enabled}


@app.middleware("http")
async def serialize_mutations(request, call_next):
    if request.method in {"POST", "PUT", "DELETE", "PATCH"}:
        async with MUTATION_LOCK:
            return await call_next(request)
    return await call_next(request)


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
    if api_id in {1102, 1201, 1202}:
        return {"success": False, "error": "Navigația nativă este dezactivată în nav2_v4"}
    node = ros()
    if service == "sport":
        publisher = node.sport_request_publisher
        topic = "/api/sport/request"
        response_topic = "/api/sport/response"
    elif service == "motion_switcher":
        publisher = node.motion_switcher_request_publisher
        topic = "/api/motion_switcher/request"
        response_topic = "/api/motion_switcher/response"
    elif service == "slam":
        publisher = node.request_publisher
        topic = "/api/slam_operate/request"
        response_topic = "/api/slam_operate/response"
    else:
        raise ValueError(f"Serviciu API necunoscut: {service}")
    discovery_deadline = time.monotonic() + 2.0
    while publisher.get_subscription_count() < 1:
        if time.monotonic() >= discovery_deadline:
            return {
                "success": False,
                "error": f"Serviciul Unitree nu este descoperit pe {topic}",
            }
        await asyncio.sleep(0.05)
    if api_id == 7105 and any(parameters.get("velocity", [])):
        # Discovery may have waited: never publish an old movement after a
        # pause or after sensors expired while there were no subscribers.
        health = (
            teleop_health(node)
            if node.control_owner == "teleop"
            else navigation_health(node)
        )
        if health or node.navigation_paused or node.navigation_cancel_requested:
            return {"success": False, "error": health or "Deplasarea a fost suspendată"}
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
            "error": f"API {api_id} nu a răspuns în {timeout:.2f}s ({detail})",
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


def navigation_health(node: RosBridge) -> str:
    with node.lock:
        if node.mode != "localization" or node.pose_source != "localization":
            return "Localizarea SLAM nu este activă"
        pose_age = time.time() - node.pose_at
        if not 0 <= pose_age <= POSE_MAX_AGE:
            return "Poziția SLAM nu este proaspătă"
        odom_age = time.time() - node.base_odom_at
        if not node.base_odom_at or not 0 <= odom_age <= 0.50:
            return "Odometria pelvisului nu este proaspătă"
        if not all(math.isfinite(node.pose[k]) for k in ("x", "y", "yaw")):
            return "Poziție SLAM nefinita"
        if time.monotonic() - node.foreign_motion_at < 1.0:
            return "Alt emitent trimite comenzi de mișcare; oprește-l înainte de Nav2"
        conflict = node.motion_conflict
    return conflict or node.nav2.health_error()


def teleop_health(node: RosBridge) -> str:
    with node.lock:
        if not node.teleop_enabled or node.control_owner != "teleop":
            return "Teleoperarea nu este armată"
        try:
            expected_fsms = locomotion_fsms_for_service(node.motion_service_name)
        except ValueError as exc:
            return str(exc)
        if node.robot_fsm not in expected_fsms or not node.run_profile_accepted:
            return (
                f"Teleoperarea cere serviciul {node.motion_service_name!r}, RUN și "
                f"FSM din {sorted(expected_fsms)}"
            )
        odom_age = time.time() - node.base_odom_at
        if not node.base_odom_at or not 0 <= odom_age <= 0.50:
            return "Odometria pelvisului nu este proaspătă"
        if time.monotonic() - node.foreign_motion_at < 1.0:
            return "Alt emitent locomotor este activ"
        conflict = node.motion_conflict
    if not teleop_keyboard.running():
        return "Procesul teleop_twist_keyboard nu mai rulează"
    return conflict


async def send_velocity(
    vx: float,
    vy: float,
    wz: float,
    duration: float = SPORT_COMMAND_DURATION,
    ros_velocity: Optional[tuple[float, float, float]] = None,
) -> dict[str, Any]:
    values = [float(vx), float(vy), float(wz)]
    if not all(math.isfinite(value) for value in values):
        return {"success": False, "error": "Comandă de viteză nefinita"}
    result = await command(
        7105, {"velocity": values, "duration": max(0.1, min(float(duration), 1.0))},
        timeout=0.45, service="sport",
    )
    source_values = values if ros_velocity is None else [float(value) for value in ros_velocity]
    node = bridge
    if node is not None:
        with node.lock:
            node.last_ros_velocity = source_values
            node.last_forwarded_velocity = values
            node.last_forwarded_at = time.monotonic()
            node.last_velocity_accepted = bool(result.get("success"))
    return result


async def stop_nav2_navigation(node: RosBridge, message: str) -> dict[str, Any]:
    node.pending_route = None
    node.navigation_cancel_requested = True
    active = (
        node.motion_active
        or node.teleop_enabled
        or node.nav2.status()["state"] in Nav2Runtime.ACTIVE_STATES
    )
    try:
        cancelled = await asyncio.to_thread(node.nav2.cancel, False)
    except Exception:
        cancelled = False
    await asyncio.to_thread(teleop_keyboard.stop)
    with node.lock:
        node.motion_active = False
        node.navigation_paused = False
        node.teleop_enabled = False
        node.control_owner = "disabled"
    node.nav2.set_control_mode("disabled")
    if active:
        async with MOTION_LOCK:
            stopped = await send_velocity(0.0, 0.0, 0.0)
        return {**stopped, "cancelled": cancelled, "message": message}
    return {"success": True, "cancelled": cancelled, "message": message}


async def velocity_forward_loop() -> None:
    """Unicul bridge cmd_vel→Sport API; maximum 10 Hz, cu watchdog.

    Nav2 și teleop pot publica oricât doresc, însă selectorul acceptă exact o
    sursă și niciun mesaj nu produce mișcare fără ``motion_active``.
    """
    last_dispatch = 0.0
    nonzero_sent = False
    pipeline_broken_at = 0.0
    while True:
        await asyncio.sleep(0.04)
        node = bridge
        if node is None:
            continue
        runtime_status = node.nav2.status()
        nav_state = runtime_status["state"]
        with node.lock:
            owner = node.control_owner
            teleop_enabled = node.teleop_enabled
            teleop_speed = node.teleop_speed
            teleop_turn_speed = node.teleop_turn_speed
        if node.motion_active and owner == "nav2" and nav_state not in Nav2Runtime.ACTIVE_STATES:
            with node.lock:
                node.motion_active = False
                node.control_owner = "disabled"
            node.nav2.set_control_mode("disabled")
        elif node.motion_active and owner == "teleop" and not teleop_enabled:
            with node.lock:
                node.motion_active = False
                node.control_owner = "disabled"
            node.nav2.set_control_mode("disabled")
        elif node.motion_active and owner not in {"nav2", "teleop"}:
            node.motion_active = False
        if not node.motion_active or node.navigation_paused:
            pipeline_broken_at = 0.0
            if nonzero_sent:
                async with MOTION_LOCK:
                    await send_velocity(0.0, 0.0, 0.0)
                nonzero_sent = False
            continue
        now = time.monotonic()
        if now - last_dispatch < SPORT_COMMAND_PERIOD:
            continue
        health = teleop_health(node) if owner == "teleop" else navigation_health(node)
        # Teleop validează separat locomotion și nu depinde de lifecycle-ul
        # Nav2. Numai comenzile autonome trec prin smoother + Collision Monitor.
        velocity, received_at = (
            node.nav2.source_velocity("teleop")
            if owner == "teleop"
            else node.nav2.safe_velocity()
        )
        nav_stream_state = "fresh"
        if owner == "nav2":
            nav_velocity, nav_received_at = node.nav2.source_velocity("nav2")
            # Numai o pauză apărută DUPĂ cel puțin o comandă reală cere un
            # zero prin selector -> smoother -> Collision Monitor. La start,
            # publicarea repetată de zero înaintea primei comenzi putea ține
            # robotul pe loc și masca lipsa fluxului controller_server.
            if (
                not health
                and nav_state in Nav2Runtime.ACTIVE_STATES
                and nav_received_at > 0.0
                and now - nav_received_at > NAV_REPLAN_INPUT_GRACE
                and not runtime_status.get("smooth_stop_active", False)
            ):
                node.nav2.request_smooth_stop()
            nav_stream_state = nav_safe_stream_state(
                received_at, nav_received_at, now, nav_velocity
            )
            command_stale = nav_stream_state != "fresh"
            if nav_stream_state != "broken":
                pipeline_broken_at = 0.0
        else:
            command_stale = received_at <= 0.0 or now - received_at > SAFE_CMD_MAX_AGE
        teleop_idle = owner == "teleop" and not any(
            abs(float(value)) > 1e-4
            for value in runtime_status.get("teleop_velocity", (0.0, 0.0, 0.0))
        )
        # teleop_twist_keyboard publică numai la apăsarea unei taste. Când
        # ultima comandă cerută este zero, lipsa unui flux cmd_vel continuu
        # înseamnă repaus sigur, nu că pipeline-ul de siguranță s-a defectat.
        if command_stale and teleop_idle and not health:
            if nonzero_sent:
                async with MOTION_LOCK:
                    await send_velocity(0.0, 0.0, 0.0)
                nonzero_sent = False
            continue
        if command_stale and owner == "teleop":
            error = health or "Fluxul /cmd_vel_teleop a expirat în timpul mișcării"
            with node.lock:
                node.motion_active = False
                node.control_owner = "disabled"
                node.teleop_enabled = False
                node.teleop_error = error
            node.nav2.set_control_mode("disabled")
            async with MOTION_LOCK:
                await send_velocity(0.0, 0.0, 0.0)
            nonzero_sent = False
            continue
        # O ieșire sigură lipsă în timp ce controllerul cere mișcare oprește
        # imediat actuatorul, dar acordă pipeline-ului două secunde să revină.
        # O întrerupere DDS scurtă nu mai anulează definitiv acțiunea Nav2.
        if owner == "nav2" and nav_stream_state == "broken" and not health:
            if not pipeline_broken_at:
                pipeline_broken_at = now
            if nonzero_sent:
                async with MOTION_LOCK:
                    await send_velocity(0.0, 0.0, 0.0)
                nonzero_sent = False
            if now - pipeline_broken_at < NAV_PIPELINE_RECOVERY_GRACE:
                continue
        # Lipsa totală a primei comenzi este o defecțiune de controller/remap,
        # nu o replanificare. O raportăm înainte ca progress_checker să expire.
        if (
            owner == "nav2"
            and nav_received_at <= 0.0
            and now - node.motion_armed_at > 2.5
            and not health
        ):
            health = "controller_server nu publică prima comandă pe /nav2/cmd_vel_nav2"
        # În planificare/recovery, controllerul Nav2 poate să nu publice
        # temporar. Aceasta este o oprire intenționată, nu defectul ieșirii
        # sigure. Oprim actuatorul și lăsăm action serverul să replănuiască.
        if owner == "nav2" and nav_stream_state == "waiting" and not health:
            if nonzero_sent:
                async with MOTION_LOCK:
                    await send_velocity(0.0, 0.0, 0.0)
                nonzero_sent = False
            continue
        if command_stale and now - node.motion_armed_at <= 2.5:
            continue
        if health or command_stale:
            error = health or "Ieșirea /nav2/cmd_vel_safe a expirat"
            with node.lock:
                node.motion_active = False
                node.control_owner = "disabled"
                if owner == "teleop":
                    node.teleop_enabled = False
                    node.teleop_error = error
            node.nav2.set_control_mode("disabled")
            if owner == "nav2":
                try:
                    await asyncio.to_thread(node.nav2.cancel, False)
                except Exception:
                    pass
                node.nav2.fail(error)
            async with MOTION_LOCK:
                await send_velocity(0.0, 0.0, 0.0)
            nonzero_sent = False
            continue
        if owner == "teleop":
            ros_velocity = teleop_velocity_command(
                velocity, teleop_speed, teleop_turn_speed
            )
            forward_limit = teleop_speed
        else:
            # /nav2/cmd_vel_safe este deja în base_link. Maparea manuală
            # păstrează semnele ROS REP-103 și nu rotește din nou cu yaw-ul
            # global. În special, zero/reducerile Collision Monitor rămân zero.
            ros_velocity = velocity
            forward_limit = float(node.motion_speed_limit)
        try:
            vx, vy, wz = ros_twist_to_unitree(
                ros_velocity,
                forward_limit=forward_limit,
                limits=UNITREE_VELOCITY_LIMITS,
                transform=UNITREE_BODY_TRANSFORM,
            )
        except ValueError as exc:
            error = f"Transformarea Twist→7105 a eșuat: {exc}"
            with node.lock:
                node.motion_active = False
                node.control_owner = "disabled"
            node.nav2.set_control_mode("disabled")
            if owner == "nav2":
                try:
                    await asyncio.to_thread(node.nav2.cancel, False)
                except Exception:
                    pass
                node.nav2.fail(error)
            async with MOTION_LOCK:
                await send_velocity(0.0, 0.0, 0.0)
            nonzero_sent = False
            continue
        async with MOTION_LOCK:
            result = await send_velocity(vx, vy, wz, ros_velocity=ros_velocity)
        last_dispatch = time.monotonic()
        if not result.get("success"):
            error = result.get("error", "Adaptorul locomotor a respins viteza")
            with node.lock:
                node.motion_active = False
                node.control_owner = "disabled"
                if owner == "teleop":
                    node.teleop_enabled = False
                    node.teleop_error = error
            node.nav2.set_control_mode("disabled")
            if owner == "nav2":
                try:
                    await asyncio.to_thread(node.nav2.cancel, False)
                except Exception:
                    pass
                node.nav2.fail(error)
            nonzero_sent = False
            continue
        nonzero_sent = any(abs(value) > 1e-4 for value in (vx, vy, wz))
        if nonzero_sent and command_can_verify_actuation(vx, vy, wz):
            with node.lock:
                odom_pose = dict(node.base_odom_pose) if node.base_odom_pose else None
                if not node.actuation_probe_at and odom_pose:
                    node.actuation_probe_at = last_dispatch
                    node.actuation_probe_pose = odom_pose
                probe_at = node.actuation_probe_at
                probe_pose = dict(node.actuation_probe_pose) if node.actuation_probe_pose else None
                verified = node.actuation_verified
            if probe_pose and odom_pose and not verified:
                moved = math.hypot(
                    odom_pose["x"] - probe_pose["x"], odom_pose["y"] - probe_pose["y"]
                )
                turned = abs(
                    (odom_pose["yaw"] - probe_pose["yaw"] + math.pi) % (2.0 * math.pi) - math.pi
                )
                progress_timeout = TELEOP_PROGRESS_TIMEOUT if owner == "teleop" else 6.0
                if moved >= 0.04 or turned >= 0.08:
                    with node.lock:
                        node.actuation_verified = True
                        if owner == "teleop":
                            node.teleop_verified = True
                            node.teleop_error = ""
                elif last_dispatch - probe_at >= progress_timeout:
                    error = (
                        "API 7105 acceptă viteza, dar odom_pelvis nu arată mișcare; "
                        "verifică autoritatea locomotorie/FSM, nu obstacolele Nav2"
                    )
                    with node.lock:
                        node.motion_active = False
                        node.control_owner = "disabled"
                        if owner == "teleop":
                            node.teleop_enabled = False
                            node.teleop_error = error
                    node.nav2.set_control_mode("disabled")
                    if owner == "nav2":
                        try:
                            await asyncio.to_thread(node.nav2.cancel, False)
                        except Exception:
                            pass
                        node.nav2.fail(error)
                    async with MOTION_LOCK:
                        await send_velocity(0.0, 0.0, 0.0)
                    nonzero_sent = False
        elif owner == "teleop" or not node.actuation_verified:
            with node.lock:
                node.actuation_probe_at = 0.0
                node.actuation_probe_pose = None


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
            else "locomotion" if fsm_id in LOCOMOTION_FSMS
            else None
        )
        if reported_mode:
            node.robot_mode = reported_mode
    return {**result, "fsm_id": fsm_id}


async def read_motion_service() -> dict[str, Any]:
    """Citește proprietarul high-level fără să schimbe modul robotului."""
    result = await command(1001, {}, timeout=3.0, service="motion_switcher")
    if not result.get("success"):
        return {
            **result,
            "error": f"MotionSwitcher CheckMode a eșuat: {result.get('error', '')}",
        }
    response = result.get("response") or {}
    payload = response.get("payload") or {}
    name = str(payload.get("name") or "").strip().lower()
    form = str(payload.get("form") or "").strip()
    if name not in {"ai", "normal"}:
        return {
            "success": False,
            "error": f"MotionSwitcher a raportat serviciul necunoscut {name!r}",
            "response": response,
        }
    node = ros()
    with node.lock:
        node.motion_service_name = name
        node.motion_service_form = form
    return {**result, "service_name": name, "service_form": form}


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
    """Activează RUN prin serviciul raportat efectiv de MotionSwitcher."""
    node = ros()
    with node.lock:
        node.teleop_verified = False
        node.teleop_error = ""
    current = await read_robot_fsm()
    if not current.get("success"):
        return current
    service_state = await read_motion_service()
    if not service_state.get("success"):
        return service_state
    service_name = service_state["service_name"]
    initial_fsm = int(current["fsm_id"])
    if initial_fsm not in ({4} | LOCOMOTION_FSMS):
        ready = await set_and_confirm_fsm(4, {4}, timeout=9.0)
        if not ready.get("success"):
            return {
                **ready,
                "error": f"Tranziția intermediară READY a eșuat: {ready.get('error', '')}",
            }

    if service_name == "ai":
        control_api, control_payload = 7111, {"data": 2}
        requested_fsm, expected_fsms = 801, INTERNAL_CONTROL_FSMS
        control_name = "internal_ai"
    else:
        control_api, control_payload = 7110, {"data": False}
        requested_fsm, expected_fsms = 500, DIRECT_CONTROL_FSMS
        control_name = "external_user"
    control_result = await command(
        control_api, control_payload, timeout=5.0, service="sport"
    )
    if not control_result.get("success"):
        return {
            **control_result,
            "error": (
                f"Controlul {control_name} nu a fost acordat: "
                f"{control_result.get('error', '')}"
            ),
        }
    await asyncio.sleep(0.50)
    # Recerem FSM-ul chiar dacă este deja raportat, astfel încât fiecare
    # sesiune să-și reînnoiască autoritatea fără un al doilea controller.
    locomotion_fsm = await set_and_confirm_fsm(
        requested_fsm, expected_fsms, timeout=7.0
    )
    if not locomotion_fsm.get("success"):
        return {**locomotion_fsm, "switch_response": control_result}
    profile = await enforce_run_profile()
    if not profile.get("success"):
        return profile
    return {
        "success": True,
        "fsm_id": locomotion_fsm["fsm_id"],
        "control": control_name,
        "motion_service": service_name,
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
    # Tokenul curent înlocuiește automat orice token vechi din sessionStorage.
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
    stopped = await stop_nav2_navigation(node, "Cartografierea a înlocuit ruta activă")
    if not stopped.get("success"):
        return stopped
    node.clear_map()
    _reset_semantic_chairs()
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
        node.pose = {"x": 0.0, "y": 0.0, "yaw": 0.0}
        node.pose_source = "initial"
        node.pose_at = now
        node.session_dir = None
        node.snapshot_index = 0
        node.last_snapshot = None
        node.pending_route = None
        node.mapping_paused = False
        node.mapping_backend = "native_slam"
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
        "mapping_backend": "native_slam",
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
    if backend == "native_slam":
        native_target = f'/home/unitree/.g1_nav2_v4_stopped_{int(time.time() * 1000)}.pcd'
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
    if target.exists() or target_2d.exists():
        return {
            "success": False,
            "error": (
                f"Harta {name!r} există deja; alege un nume nou. "
                "V3 nu suprascrie hărți PCD existente."
            ),
        }
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
    native_target = f"/home/unitree/.g1_nav2_v4_{name}_{int(time.time() * 1000)}.pcd"
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
    stopped = await stop_nav2_navigation(node, "O localizare nouă a înlocuit ruta activă")
    if not stopped.get("success"):
        return stopped
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
        planar_path = MAPS_2D / path.name
        planar_points = (
            await asyncio.to_thread(read_pcd, planar_path)
            if planar_path.is_file()
            else await asyncio.to_thread(flatten_cloud_xy, points)
        )
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
        node.selected_map = name
        node.localization_frame = ""
        node.localization_input = ""
        node.motion_conflict = ""
        node.pose = {"x": x, "y": y, "yaw": yaw}
        node.pose_source = "initial"
        node.pose_at = time.time()
        node.session_dir = None
        node.pending_route = None
    car_integration.set_g1_map(name)
    _reset_semantic_chairs(str(path))
    node.set_loaded_map(points)
    node.nav2.update_map_pose({"x": x, "y": y, "yaw": yaw})
    try:
        grid = await asyncio.to_thread(node.nav2.publish_map, planar_points, (x, y))
    except ValueError as exc:
        with node.lock:
            node.mode = "idle"
        return {"success": False, "error": f"Harta Nav2 nu poate fi rasterizată: {exc}"}
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
        "nav2_grid": grid,
        "cloud_ready": cloud_ready,
        "response": result.get("response"),
    }


@app.post("/api/navigation/speed")
async def set_navigation_speed(
    body: dict = Body(...), x_dashboard_token: str = Header(default="")
):
    authorize(x_dashboard_token)
    try:
        speed = navigation_target({
            "x": 0.0, "y": 0.0, "yaw": 0.0, "speed": body["speed"],
        })[3]
    except (KeyError, TypeError, ValueError) as exc:
        return {"success": False, "error": f"Viteză invalidă: {exc}"}
    node = ros()
    with node.lock:
        node.navigation_speed = speed
    return {
        "success": True,
        "speed": speed,
        "message": f"Viteză Nav2: {speed:.2f} m/s",
    }


@app.post("/api/navigation/preview")
async def navigation_preview(
    body: dict = Body(...), x_dashboard_token: str = Header(default="")
):
    authorize(x_dashboard_token)
    node = ros()
    if node.nav2.status()["state"] in Nav2Runtime.ACTIVE_STATES:
        return {"success": False, "error": "Există deja o rută Nav2 activă"}
    try:
        x, y, yaw, speed = navigation_target(body)
    except (KeyError, TypeError, ValueError) as exc:
        return {"success": False, "error": f"Țintă invalidă: {exc}"}
    map_name = str(body.get("map") or "").strip()
    with node.lock:
        node.navigation_speed = speed
        start = (float(node.pose["x"]), float(node.pose["y"]))
        selected_map = node.selected_map
    if map_name != selected_map:
        return {"success": False, "error": "Harta aleasă nu este harta localizării active"}
    health = navigation_health(node)
    if health:
        return {"success": False, "error": health}
    try:
        route = await asyncio.to_thread(node.nav2.compute_path, x, y, yaw)
    except (RuntimeError, TimeoutError, ValueError) as exc:
        with node.lock:
            node.pending_route = None
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
    return {
        "success": True,
        "message": "Ruta Nav2 este doar previzualizată; nu s-a trimis nicio comandă de mers",
        "preview_id": preview_id,
        "start": {"x": start[0], "y": start[1]},
        "goal": {"x": x, "y": y, "yaw": yaw, "speed": speed},
        "route": route,
        "expires_in": 120,
    }


@app.post("/api/teleop/enable")
async def enable_teleop(
    body: dict = Body(...), x_dashboard_token: str = Header(default="")
):
    """Armează tastatura; nu publică singur nicio viteză nenulă."""
    authorize(x_dashboard_token)
    if not secrets.compare_digest(str(body.get("password") or ""), "123"):
        raise HTTPException(403, "Parolă incorectă pentru teleoperare")
    if body.get("exclusive_control") is not True:
        return {
            "success": False,
            "error": "Confirmă că maneta și ceilalți emițători de mișcare sunt opriți",
        }
    try:
        requested_speed = teleop_speed_value(
            body.get("speed", TELEOP_LINEAR_DEFAULT)
        )
        requested_turn_speed = teleop_turn_speed_value(
            body.get("turn_speed", TELEOP_ANGULAR_DEFAULT)
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc
    node = ros()
    stopped = await stop_nav2_navigation(
        node, "Teleoperarea a preluat controlul exclusiv"
    )
    if not stopped.get("success"):
        return stopped
    current = await activate_run_mode()
    if not current.get("success"):
        return {
            **current,
            "error": f"Teleop nu a putut rearma RUN: {current.get('error', '')}",
        }
    now_wall = time.time()
    with node.lock:
        odom_ok = bool(node.base_odom_at and 0 <= now_wall - node.base_odom_at <= 0.50)
        foreign_recent = time.monotonic() - node.foreign_motion_at < 1.0
    if not odom_ok:
        return {"success": False, "error": "Odometria pelvisului nu este proaspătă"}
    if foreign_recent:
        return {
            "success": False,
            "error": "Alt emitent locomotor a publicat recent; oprește-l și încearcă din nou",
        }
    publisher_release_deadline = time.monotonic() + 1.0
    while (
        node.count_publishers("/cmd_vel_teleop") > 0
        and time.monotonic() < publisher_release_deadline
    ):
        await asyncio.sleep(0.05)
    if node.count_publishers("/cmd_vel_teleop") > 0:
        return {
            "success": False,
            "error": (
                "Există deja un publisher extern pe /cmd_vel_teleop; oprește "
                "start_teleop_keyboard.sh înainte de controlul din browser"
            ),
        }
    process_result = await asyncio.to_thread(teleop_keyboard.start)
    if not process_result.get("success"):
        return process_result
    discovery_deadline = time.monotonic() + 2.0
    while node.count_publishers("/cmd_vel_teleop") < 1:
        if not teleop_keyboard.running() or time.monotonic() >= discovery_deadline:
            await asyncio.to_thread(teleop_keyboard.stop)
            return {
                "success": False,
                "error": "Nodul teleop a pornit, dar publisherul /cmd_vel_teleop nu a fost descoperit",
            }
        await asyncio.sleep(0.05)
    node.nav2.set_control_mode("teleop")
    with node.lock:
        node.navigation_cancel_requested = False
        node.navigation_paused = False
        node.motion_conflict = ""
        node.control_owner = "teleop"
        node.teleop_enabled = True
        node.teleop_speed = requested_speed
        node.teleop_turn_speed = requested_turn_speed
        node.teleop_error = ""
        node.motion_active = True
        node.motion_armed_at = time.monotonic()
        node.actuation_probe_at = 0.0
        node.actuation_probe_pose = None
        node.actuation_verified = False
    return {
        "success": True,
        "message": (
            "Teleoperare armată în dashboard; folosește săgețile/WASD sau "
            "tastele standard i/j/k/l/,"
        ),
        "topic": "/cmd_vel_teleop",
        "fsm": current.get("fsm_id"),
        "teleop_pid": process_result.get("pid"),
        "speed": requested_speed,
        "turn_speed": requested_turn_speed,
        "path": "teleop_twist_keyboard -> /cmd_vel_teleop -> API 7105",
    }


@app.post("/api/teleop/disable")
async def disable_teleop(x_dashboard_token: str = Header(default="")):
    authorize(x_dashboard_token)
    return await stop_nav2_navigation(ros(), "Teleoperarea a fost oprită")


@app.post("/api/teleop/speed")
async def set_teleop_speed(
    body: dict = Body(...), x_dashboard_token: str = Header(default="")
):
    """Schimbă limitele finale fără repornirea nodului de tastatură."""
    authorize(x_dashboard_token)
    node = ros()
    with node.lock:
        current_speed = node.teleop_speed
        current_turn_speed = node.teleop_turn_speed
    try:
        speed = teleop_speed_value(body.get("speed", current_speed))
        turn_speed = teleop_turn_speed_value(
            body.get("turn_speed", current_turn_speed)
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc
    with node.lock:
        node.teleop_speed = speed
        node.teleop_turn_speed = turn_speed
        active = node.teleop_enabled and node.control_owner == "teleop"
    return {
        "success": True,
        "speed": speed,
        "turn_speed": turn_speed,
        "message": (
            f"Teleop aplicat: {speed:.2f} m/s, {turn_speed:.2f} rad/s"
            if active
            else f"Teleop salvat: {speed:.2f} m/s, {turn_speed:.2f} rad/s"
        ),
    }


@app.post("/api/teleop/key")
async def teleop_key(
    body: dict = Body(...), x_dashboard_token: str = Header(default="")
):
    authorize(x_dashboard_token)
    node = ros()
    key = str(body.get("key") or "")
    with node.lock:
        enabled = node.teleop_enabled and node.control_owner == "teleop"
    if not enabled:
        return {"success": False, "error": "Teleoperarea nu este armată"}
    result = await asyncio.to_thread(teleop_keyboard.send_key, key)
    if result.get("success") and key in TeleopKeyboardProcess.MOTION_KEYS:
        with node.lock:
            # O tastă poate veni la mult timp după armare; acordăm pipeline-ului
            # timpul de discovery/smoothing de la această comandă, nu de la click.
            node.motion_armed_at = time.monotonic()
    if not result.get("success"):
        with node.lock:
            node.teleop_error = result.get("error", "Terminalul teleop nu răspunde")
        await stop_nav2_navigation(node, node.teleop_error)
    return result


@app.post("/api/navigation/goal")
async def navigation_goal(body: dict = Body(...), x_dashboard_token: str = Header(default="")):
    authorize(x_dashboard_token)
    if body.get("exclusive_control") is not True:
        return {"success": False, "error": "Confirmă că navigația nativă și ceilalți emițători de mișcare sunt opriți"}
    node = ros()
    health = navigation_health(node)
    if health:
        return {"success": False, "error": health}
    try:
        x, y, yaw, speed = navigation_target(body)
    except (KeyError, TypeError, ValueError) as exc:
        return {"success": False, "error": f"Tinta invalida: {exc}"}
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
            and map_name == node.selected_map
            and math.hypot(
                current_x - float(preview["start_x"]),
                current_y - float(preview["start_y"]),
            ) <= 0.25
        )
    if not valid_preview:
        return {
            "success": False,
            "error": "Ruta trebuie previzualizată din nou și confirmată fără modificarea țintei",
        }
    if node.nav2.status()["state"] in Nav2Runtime.ACTIVE_STATES:
        return {"success": False, "error": "Există deja o rută Nav2 activă"}
    # Transfer exclusiv teleop -> Nav2. Validarea teleop rămâne memorată, dar
    # nicio comandă veche din tastatură nu poate ajunge în noua rută.
    with node.lock:
        node.teleop_enabled = False
        node.motion_active = False
        node.control_owner = "disabled"
    node.nav2.set_control_mode("disabled")
    async with MOTION_LOCK:
        await send_velocity(0.0, 0.0, 0.0)
    # Nu schimbăm FSM-ul pentru a porni un controller nativ. Verificăm că
    # operatorul a ales locomotion și reaplicăm numai profilul RUN (7107).
    try:
        run_ready = await prepare_navigation_run()
    except Exception as exc:
        raise HTTPException(503, f"Pregătirea locomotiei a eșuat: {exc}") from exc
    if not run_ready.get("success"):
        return run_ready
    health = navigation_health(node)
    if health or math.hypot(node.pose["x"]-preview["start_x"], node.pose["y"]-preview["start_y"]) > 0.25:
        node.motion_active = False
        return {"success": False, "error": health or "Robotul s-a deplasat în timpul pregătirii; recalculează"}
    with node.lock:
        node.pending_route = None
        node.navigation_cancel_requested = False
        node.navigation_paused = False
        node.motion_speed_limit = speed
        node.actuation_probe_at = 0.0
        node.actuation_probe_pose = None
        node.actuation_verified = False
        node.control_owner = "nav2"
    node.nav2.set_control_mode("nav2")
    try:
        target = await asyncio.to_thread(node.nav2.navigate, x, y, yaw, speed)
    except (RuntimeError, TimeoutError) as exc:
        with node.lock:
            node.control_owner = "disabled"
        node.nav2.set_control_mode("disabled")
        async with MOTION_LOCK:
            await send_velocity(0.0, 0.0, 0.0)
        return {"success": False, "error": str(exc)}
    node.motion_active = True
    node.motion_armed_at = time.monotonic()
    return {
        "success": True,
        "message": "Goal Nav2 acceptat; profil RUN solicitat",
        "goal": target,
        "executor": "nav2",
        "fsm": run_ready.get("fsm_id"),
        "run_profile_accepted": True,
    }




@app.post("/api/navigation/pause")
async def pause_navigation(x_dashboard_token: str = Header(default="")):
    authorize(x_dashboard_token)
    node = ros()
    if not node.motion_active:
        return {"success": True, "message": "Nicio rută Nav2 activă"}
    try:
        cancelled = await asyncio.to_thread(node.nav2.cancel, True)
    except (RuntimeError, TimeoutError) as exc:
        return {"success": False, "error": str(exc)}
    node.navigation_paused = cancelled
    node.motion_active = False
    node.control_owner = "disabled"
    node.nav2.set_control_mode("disabled")
    async with MOTION_LOCK:
        result = await send_velocity(0.0, 0.0, 0.0)
    return {**result, "cancelled": cancelled, "message": "Ruta Nav2 este în pauză"}


@app.post("/api/navigation/resume")
async def resume_navigation(x_dashboard_token: str = Header(default="")):
    authorize(x_dashboard_token)
    node = ros()
    if not node.navigation_paused or node.nav2.status()["state"] != "paused":
        return {"success": False, "error": "Nu există o rută Nav2 în pauză"}
    if node.motion_conflict:
        return {"success": False, "error": "Conflict de control; oprește ruta și previzualizează din nou"}
    health = navigation_health(node)
    if health:
        return {"success": False, "error": health}
    result = await prepare_navigation_run()
    if result.get("success"):
        health = navigation_health(node)
        if health:
            return {"success": False, "error": health}
        try:
            node.nav2.set_control_mode("nav2")
            node.control_owner = "nav2"
            target = await asyncio.to_thread(node.nav2.resume)
        except (RuntimeError, TimeoutError) as exc:
            node.control_owner = "disabled"
            node.nav2.set_control_mode("disabled")
            return {"success": False, "error": str(exc)}
        node.navigation_paused = False
        node.motion_active = True
        node.motion_armed_at = time.monotonic()
        return {**result, "message": "Ruta Nav2 a fost reluată în RUN", "goal": target}
    return result


@app.post("/api/navigation/stop")
async def stop_navigation(x_dashboard_token: str = Header(default="")):
    authorize(x_dashboard_token)
    return await stop_nav2_navigation(ros(), "Ruta Nav2 a fost oprită")


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
    stopped = await stop_nav2_navigation(node, "Schimbarea modului robotului a anulat ruta")
    if not stopped.get("success"):
        return stopped
    node.motion_conflict = ""
    # Mutation middleware already serializes HTTP mode changes with route starts.
    if mode == "run":
        result = await activate_run_mode()
    else:
        requested = int(fsm_by_mode[mode])
        result = await set_and_confirm_fsm(requested, {requested}, timeout=9.0)
    if result.get("success"):
        with node.lock:
            node.robot_mode = mode
            node.run_profile_accepted = mode == "run"
            node.robot_fsm = int(result["fsm_id"])
    return {
        **result,
        "mode": mode if result.get("success") else node.state()["robot_mode"],
        "fsm": result.get("fsm_id"),
        "message": (
            f"FSM {result.get('fsm_id')} citit; cererea {mode.upper()} acceptată"
            if result.get("success") else result.get("error")
        ),
    }


def _robot_navigation_public_state() -> dict[str, Any]:
    state = ros().state()
    navigation = dict(state.get("navigation") or {})
    pose_age = state.get("pose_age")
    path = navigation.get("path") or []
    path_age = navigation.get("path_updated_age")
    return {
        "type": "robot_state",
        "connected": bool(rclpy.ok()),
        "last_seen": (
            time.time() - float(pose_age)
            if pose_age is not None
            else 0.0
        ),
        "pose_age": pose_age,
        "pose": state.get("pose"),
        "path": path,
        "path_topic": "/plan",
        "path_updated_at": (
            time.time() - float(path_age)
            if path_age is not None
            else 0.0
        ),
        "path_point_count": len(path),
        "path_revision": navigation.get("path_revision", 0),
        "navigation": navigation,
    }


def _robot_navigation_goal(body: dict[str, Any]) -> dict[str, Any]:
    node = ros()
    with node.lock:
        dashboard_speed = float(node.navigation_speed)
    goal = {
        "x": float(body["x"]),
        "y": float(body["y"]),
        "yaw": math.radians(float(body.get("yaw_deg", 0.0))),
        # Casca VR nu configurează viteza. Ignorăm orice valoare implicită
        # trimisă de client și folosim profilul de bază al dashboard-ului.
        "speed": dashboard_speed,
    }
    if not all(math.isfinite(value) for value in goal.values()):
        raise ValueError("Ținta trebuie să fie finită")
    return goal


@app.get("/api/robot/status")
async def robot_navigation_status():
    return {"success": True, **_robot_navigation_public_state()}


@app.post("/api/robot/path/preview")
async def preview_robot_path(body: dict = Body(...)):
    try:
        goal = _robot_navigation_goal(body)
    except (KeyError, TypeError, ValueError) as exc:
        return {"success": False, "error": f"Țintă invalidă: {exc}"}
    node = ros()
    with node.lock:
        map_name = str(node.selected_map or "")
    result = await navigation_preview({**goal, "map": map_name}, TOKEN)
    if not result.get("success"):
        return result
    map_goal = {"x": goal["x"], "y": goal["y"], "yaw": goal["yaw"]}
    return {
        **result,
        "request_id": result["preview_id"],
        "map_goal": map_goal,
        "robot_map_goal": map_goal,
    }


@app.post("/api/robot/goal")
async def send_robot_goal(body: dict = Body(...)):
    try:
        goal = _robot_navigation_goal(body)
    except (KeyError, TypeError, ValueError) as exc:
        return {"success": False, "error": f"Țintă invalidă: {exc}"}
    node = ros()
    with node.lock:
        map_name = str(node.selected_map or "")
    preview_id = str(body.get("preview_id") or body.get("request_id") or "")
    if not preview_id:
        preview = await navigation_preview({**goal, "map": map_name}, TOKEN)
        if not preview.get("success"):
            return preview
        preview_id = str(preview["preview_id"])
    result = await navigation_goal(
        {
            **goal,
            "map": map_name,
            "preview_id": preview_id,
            "exclusive_control": True,
        },
        TOKEN,
    )
    if not result.get("success"):
        return result
    map_goal = {"x": goal["x"], "y": goal["y"], "yaw": goal["yaw"]}
    return {
        **result,
        "type": "goal_pose",
        "request_id": preview_id,
        "map_goal": map_goal,
        "robot_map_goal": map_goal,
    }


@app.post("/api/map/clear")
async def clear_map(x_dashboard_token: str = Header(default="")):
    authorize(x_dashboard_token)
    stopped = await stop_nav2_navigation(ros(), "Vizualizarea a fost golită")
    if not stopped.get("success"):
        return stopped
    ros().clear_map()
    _reset_semantic_chairs()
    return {"success": True}
