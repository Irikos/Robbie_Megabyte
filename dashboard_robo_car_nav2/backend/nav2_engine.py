#!/usr/bin/env python3
"""nav2_engine.py — motorul de navigație Nav2 pentru robot+car.

Acest modul aduce în dashboardul yolo-car EXACT lanțul de navigație validat în
``dashboard_g1_nav2_v3``: Nav2 planifică ruta (``ComputePathToPose`` pentru
preview, ``NavigateToPose`` pentru execuție + replanificare), iar comanda finală
ajunge la robot numai prin adaptorul ROS 2 ``unitree_api`` (Sport API ``7105``).

Nu există niciun planner A* și niciun apel la navigatorul nativ Unitree
(``1102/1201/1202``): acele API-uri sunt refuzate explicit, la fel ca în v3.

Motorul rulează izolat de restul serverului:
  * are propriul nod rclpy (``robot_car_nav2_engine``) și propriul executor;
  * ``Nav2Runtime`` creează singur toate publisher/subscriber-ele și action
    clients (``/compute_path_to_pose``, ``/navigate_to_pose``, ``/spin``);
  * serverul îl alimentează cu poza de localizare (``update_map_pose``),
    odometria pelvisului (``update_local_odometry``) și harta rasterizată
    (``publish_map``);
  * bucla ``velocity_loop`` ia ``safe_velocity`` de pe ``/nav2/cmd_vel_safe`` și
    o trimite la ``7105`` prin ``motion_adapter.ros_twist_to_unitree``.

Serverul apelează metodele publice ``async`` (``preview``, ``goal``, ``pause``,
``resume``, ``stop``, ``status``) și metodele de alimentare
(``set_map``/``update_map_pose``/``update_local_odometry``).
"""

from __future__ import annotations

import asyncio
import json
import math
import threading
import time
from typing import Any, Optional

import rclpy
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from nav_msgs.msg import Odometry

from unitree_api.msg import Request as UnitreeRequest
from unitree_api.msg import Response as UnitreeResponse

from nav2_runtime import Nav2Runtime
from motion_adapter import (
    DEFAULT_LIMITS as UNITREE_VELOCITY_LIMITS,
    DEFAULT_TRANSFORM as UNITREE_BODY_TRANSFORM,
    ros_twist_to_unitree,
)

# ── Constante de timing (identice cu v3) ──────────────────────────────────────
POSE_MAX_AGE = 1.0
BASE_ODOM_MAX_AGE = 0.50
SAFE_CMD_MAX_AGE = 0.40
NAV_SAFE_CMD_MAX_AGE = 0.75
NAV_REPLAN_INPUT_GRACE = 0.20
NAV_PIPELINE_RECOVERY_GRACE = 2.00
SPORT_COMMAND_PERIOD = 0.10
SPORT_COMMAND_DURATION = 0.65
NAV_PROGRESS_TIMEOUT = 6.0

# API-uri native de navigație interzise (ca în nav2_v3).
FORBIDDEN_NATIVE_APIS = {1102, 1201, 1202}


def quaternion_yaw(orientation) -> float:
    x = float(orientation.x)
    y = float(orientation.y)
    z = float(orientation.z)
    w = float(orientation.w)
    return math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))


def command_can_verify_actuation(vx: float, vy: float, wz: float) -> bool:
    """O comandă suficient de mare încât mișcarea să fie detectabilă în odom."""
    return abs(vx) >= 0.05 or abs(vy) >= 0.05 or abs(wz) >= 0.15


def nav_safe_stream_state(
    safe_at: float,
    source_at: float,
    now: float,
    source_velocity: tuple,
) -> str:
    """Reproduce logica din v3: distinge fluxul sigur proaspăt / în așteptare /
    întrerupt pe baza vârstei ieșirii ``/nav2/cmd_vel_safe`` și a ultimei comenzi
    a controllerului ``/nav2/cmd_vel_nav2``."""
    safe_fresh = safe_at > 0.0 and now - safe_at <= NAV_SAFE_CMD_MAX_AGE
    if safe_fresh:
        return "fresh"
    source_fresh = source_at > 0.0 and now - source_at <= NAV_SAFE_CMD_MAX_AGE
    controller_wants_motion = any(abs(float(v)) > 1e-4 for v in source_velocity)
    if source_fresh and not controller_wants_motion:
        # Controllerul cere zero (planificare/recovery); nu e o defecțiune.
        return "waiting"
    if source_fresh and controller_wants_motion:
        return "broken"
    return "waiting"


class _EngineNode(Node):
    """Nod rclpy dedicat motorului Nav2 + adaptorul Sport 7105."""

    def __init__(self) -> None:
        super().__init__("robot_car_nav2_engine")
        self._callbacks = ReentrantCallbackGroup()
        reliable_qos = QoSProfile(
            depth=10,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.VOLATILE,
        )
        self.sport_request_publisher = self.create_publisher(
            UnitreeRequest, "/api/sport/request", reliable_qos
        )
        self.create_subscription(
            UnitreeResponse, "/api/sport/response", self._store_response,
            reliable_qos, callback_group=self._callbacks,
        )
        self.arm_request_publisher = self.create_publisher(
            UnitreeRequest, "/api/arm/request", reliable_qos
        )
        self.create_subscription(
            UnitreeResponse, "/api/arm/response", self._store_response,
            reliable_qos, callback_group=self._callbacks,
        )
        self._request_id = time.monotonic_ns()
        self._id_lock = threading.Lock()
        self._responses: dict[int, dict] = {}
        self._response_condition = threading.Condition()

    # — Sport API request/response (ca send_request/wait_response din v3) —
    def send_request(self, api_id: int, parameters: dict, service: str = "sport") -> int:
        if int(api_id) in FORBIDDEN_NATIVE_APIS:
            raise ValueError("Navigația nativă 1102/1201/1202 este dezactivată")
        with self._id_lock:
            self._request_id += 1
            request_id = self._request_id
        message = UnitreeRequest()
        message.header.identity.id = request_id
        message.header.identity.api_id = int(api_id)
        message.header.lease.id = 0
        message.header.policy.priority = 1
        message.header.policy.noreply = False
        message.parameter = json.dumps(parameters, separators=(",", ":"))
        message.binary = []
        if service == "sport":
            self.sport_request_publisher.publish(message)
        elif service == "arm":
            self.arm_request_publisher.publish(message)
        else:
            raise ValueError(f"Serviciu API necunoscut: {service}")
        return request_id

    def _store_response(self, message: UnitreeResponse) -> None:
        try:
            payload = json.loads(message.data or "{}")
        except (json.JSONDecodeError, TypeError):
            payload = {"raw": getattr(message, "data", "")}
        record = {
            "request_id": int(message.header.identity.id),
            "api_id": int(message.header.identity.api_id),
            "status_code": int(message.header.status.code),
            "payload": payload,
            "received_at": time.monotonic(),
        }
        with self._response_condition:
            self._responses[record["request_id"]] = record
            while len(self._responses) > 128:
                self._responses.pop(next(iter(self._responses)))
            self._response_condition.notify_all()

    def wait_response(
        self, request_id: int, api_id: int, sent_at: float, timeout: float
    ) -> Optional[dict]:
        deadline = time.monotonic() + timeout
        with self._response_condition:
            while True:
                exact = self._responses.pop(request_id, None)
                if exact and exact["api_id"] == api_id and exact["received_at"] >= sent_at:
                    return exact
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self._response_condition.wait(remaining)

    def count_subscriptions(self, topic: str) -> int:
        return self.sport_request_publisher.get_subscription_count()


class Nav2Engine:
    """Fațada folosită de server.py. Un singur motor Nav2 pentru robot."""

    def __init__(self) -> None:
        self._node: Optional[_EngineNode] = None
        self._executor: Optional[MultiThreadedExecutor] = None
        self._spin_thread: Optional[threading.Thread] = None
        self.nav2: Optional[Nav2Runtime] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._velocity_task: Optional[asyncio.Task] = None
        self._motion_lock = asyncio.Lock()
        self.lock = threading.RLock()

        # Stare de control (echivalent cu starea RosBridge din v3, doar Nav2).
        self.control_mode = "disabled"      # "disabled" | "nav2"
        self.motion_active = False
        self.motion_armed_at = 0.0
        self.navigation_paused = False
        self.motion_speed_limit = 0.60
        self.map_ready = False

        # Poze pentru health + verificarea actuației.
        self._pose: Optional[dict] = None
        self._pose_at = 0.0
        self._base_odom_pose: Optional[dict] = None
        self._base_odom_at = 0.0
        self.motion_conflict = ""

        self._actuation_probe_at = 0.0
        self._actuation_probe_pose: Optional[dict] = None
        self._actuation_verified = False
        self.last_forwarded_velocity = [0.0, 0.0, 0.0]
        self.last_forwarded_at = 0.0
        self.last_velocity_accepted = False

    # ── Ciclu de viață ────────────────────────────────────────────────────────
    def ensure_started(self, loop: asyncio.AbstractEventLoop) -> None:
        """Pornește nodul, executorul și bucla de viteză (idempotent).

        Serverul inițializează contextul rclpy în startup înaintea threadurilor."""
        with self.lock:
            if self._node is not None:
                self._loop = loop
                self._ensure_velocity_task()
                return
            if not rclpy.ok():
                rclpy.init()
            self._node = _EngineNode()
            self.nav2 = Nav2Runtime(self._node)
            self._executor = MultiThreadedExecutor(num_threads=4)
            self._executor.add_node(self._node)
            self._spin_thread = threading.Thread(
                target=self._spin, name="nav2-engine-spin", daemon=True
            )
            self._spin_thread.start()
            self._loop = loop
            self._ensure_velocity_task()

    def _spin(self) -> None:
        try:
            self._executor.spin()
        except Exception:
            pass

    def _ensure_velocity_task(self) -> None:
        if self._loop is None:
            return
        if self._velocity_task is None or self._velocity_task.done():
            self._velocity_task = self._loop.create_task(self.velocity_loop())

    @property
    def available(self) -> bool:
        return self._node is not None and self.nav2 is not None

    # ── Alimentare de la server (poza / odom / hartă) ─────────────────────────
    def update_map_pose(self, pose: dict) -> None:
        if not self.available or pose is None:
            return
        try:
            clean = {
                "x": float(pose["x"]), "y": float(pose["y"]), "yaw": float(pose["yaw"])
            }
        except (KeyError, TypeError, ValueError):
            return
        if not all(math.isfinite(v) for v in clean.values()):
            return
        with self.lock:
            self._pose = clean
            self._pose_at = time.time()
        self.nav2.update_map_pose(clean)

    def update_local_odometry(self, message: Odometry) -> None:
        if not self.available or message is None:
            return
        pose = message.pose.pose
        base = {
            "x": float(pose.position.x),
            "y": float(pose.position.y),
            "yaw": quaternion_yaw(pose.orientation),
        }
        with self.lock:
            self._base_odom_pose = base
            self._base_odom_at = time.time()
        self.nav2.update_local_odometry(message)

    def set_map(self, planar_points, origin_xy) -> dict:
        """Rasterizează PCD-ul 2D și publică ``/map`` pentru Nav2."""
        if not self.available:
            raise RuntimeError("Motorul Nav2 nu este pornit")
        grid = self.nav2.publish_map(planar_points, origin_xy)
        with self.lock:
            self.map_ready = True
        return grid

    # ── Health (echivalent navigation_health din v3) ──────────────────────────
    def health(self) -> str:
        with self.lock:
            pose = dict(self._pose) if self._pose else None
            pose_at = self._pose_at
            base_at = self._base_odom_at
            conflict = self.motion_conflict
        if pose is None:
            return "Localizarea nu este activă pentru Nav2"
        pose_age = time.time() - pose_at
        if not 0 <= pose_age <= POSE_MAX_AGE:
            return "Poziția de localizare nu este proaspătă"
        if not base_at or not 0 <= time.time() - base_at <= BASE_ODOM_MAX_AGE:
            return "Odometria pelvisului nu este proaspătă"
        if not all(math.isfinite(pose[k]) for k in ("x", "y", "yaw")):
            return "Poziție de localizare nefinită"
        if conflict:
            return conflict
        return self.nav2.health_error()

    # ── Adaptorul Sport 7105 ───────────────────────────────────────────────────
    async def _send_velocity(
        self, vx: float, vy: float, wz: float, duration: float = SPORT_COMMAND_DURATION
    ) -> dict:
        values = [float(vx), float(vy), float(wz)]
        if not all(math.isfinite(v) for v in values):
            return {"success": False, "error": "Comandă de viteză nefinită"}
        node = self._node
        if node is None:
            return {"success": False, "error": "Motorul Nav2 nu este pornit"}
        # Descoperirea serviciului Sport (ca în v3).
        if node.sport_request_publisher.get_subscription_count() < 1:
            deadline = time.monotonic() + 2.0
            while node.sport_request_publisher.get_subscription_count() < 1:
                if time.monotonic() >= deadline:
                    return {
                        "success": False,
                        "error": "Serviciul Sport /api/sport/request nu este descoperit",
                    }
                await asyncio.sleep(0.05)
        if any(abs(v) > 1e-9 for v in values):
            if self.navigation_paused or not self.motion_active:
                return {"success": False, "error": "Deplasarea a fost suspendată"}
        sent_at = time.monotonic()
        request_id = node.send_request(
            7105, {"velocity": values, "duration": max(0.1, min(float(duration), 1.0))}
        )
        response = await asyncio.to_thread(
            node.wait_response, request_id, 7105, sent_at, 0.45
        )
        with self.lock:
            self.last_forwarded_velocity = values
            self.last_forwarded_at = time.monotonic()
            self.last_velocity_accepted = bool(response)
        if not response:
            return {"success": False, "error": "API 7105 nu a răspuns în 0.45s"}
        if int(response.get("status_code", -1)) != 0:
            payload = response.get("payload") or {}
            return {
                "success": False,
                "error": payload.get("info") or f"API 7105 respins (status={response.get('status_code')})",
            }
        return {"success": True, "response": response}

    # ── Bucla unică cmd_vel→Sport (portată din velocity_forward_loop v3) ───────
    async def velocity_loop(self) -> None:
        last_dispatch = 0.0
        nonzero_sent = False
        pipeline_broken_at = 0.0
        while True:
            await asyncio.sleep(0.04)
            if not self.available:
                continue
            runtime_status = self.nav2.status()
            nav_state = runtime_status["state"]
            with self.lock:
                active = self.motion_active
                paused = self.navigation_paused
                owner_nav2 = self.control_mode == "nav2"
            # Dacă ruta Nav2 s-a încheiat, dezarmează motorul.
            if active and owner_nav2 and nav_state not in Nav2Runtime.ACTIVE_STATES:
                with self.lock:
                    self.motion_active = False
                    self.control_mode = "disabled"
                self.nav2.set_control_mode("disabled")
                active = False
            if not active or paused or not owner_nav2:
                pipeline_broken_at = 0.0
                if nonzero_sent:
                    async with self._motion_lock:
                        await self._send_velocity(0.0, 0.0, 0.0)
                    nonzero_sent = False
                continue
            now = time.monotonic()
            if now - last_dispatch < SPORT_COMMAND_PERIOD:
                continue
            health = self.health()
            velocity, received_at = self.nav2.safe_velocity()
            nav_velocity, nav_received_at = self.nav2.source_velocity("nav2")
            # Pauză de replanificare: injectează un singur zero prin selector.
            if (
                not health
                and nav_state in Nav2Runtime.ACTIVE_STATES
                and nav_received_at > 0.0
                and now - nav_received_at > NAV_REPLAN_INPUT_GRACE
                and not runtime_status.get("smooth_stop_active", False)
            ):
                self.nav2.request_smooth_stop()
            stream_state = nav_safe_stream_state(received_at, nav_received_at, now, nav_velocity)
            if stream_state != "broken":
                pipeline_broken_at = 0.0

            # Prima comandă lipsă = defecțiune de controller/remap.
            if nav_received_at <= 0.0 and now - self.motion_armed_at > 2.5 and not health:
                health = "controller_server nu publică prima comandă pe /nav2/cmd_vel_nav2"

            # Întrerupere DDS scurtă: oprește actuatorul, dar acordă 2 s.
            if stream_state == "broken" and not health:
                if not pipeline_broken_at:
                    pipeline_broken_at = now
                if nonzero_sent:
                    async with self._motion_lock:
                        await self._send_velocity(0.0, 0.0, 0.0)
                    nonzero_sent = False
                if now - pipeline_broken_at < NAV_PIPELINE_RECOVERY_GRACE:
                    continue

            # Planificare/recovery: controllerul tace intenționat.
            if stream_state == "waiting" and not health:
                if nonzero_sent:
                    async with self._motion_lock:
                        await self._send_velocity(0.0, 0.0, 0.0)
                    nonzero_sent = False
                continue

            command_stale = received_at <= 0.0 or now - received_at > NAV_SAFE_CMD_MAX_AGE
            if command_stale and now - self.motion_armed_at <= 2.5:
                continue

            if health or command_stale:
                error = health or "Ieșirea /nav2/cmd_vel_safe a expirat"
                await self._abort_motion(error, cancel_route=True)
                nonzero_sent = False
                continue

            # /nav2/cmd_vel_safe este deja în base_link (REP-103); nu rotim iar.
            try:
                vx, vy, wz = ros_twist_to_unitree(
                    velocity,
                    forward_limit=float(self.motion_speed_limit),
                    limits=UNITREE_VELOCITY_LIMITS,
                    transform=UNITREE_BODY_TRANSFORM,
                )
            except ValueError as exc:
                await self._abort_motion(f"Transformarea Twist→7105 a eșuat: {exc}", cancel_route=True)
                nonzero_sent = False
                continue

            async with self._motion_lock:
                result = await self._send_velocity(vx, vy, wz)
            last_dispatch = time.monotonic()
            if not result.get("success"):
                await self._abort_motion(
                    result.get("error", "Adaptorul locomotor a respins viteza"),
                    cancel_route=True,
                )
                nonzero_sent = False
                continue
            nonzero_sent = any(abs(v) > 1e-4 for v in (vx, vy, wz))
            if nonzero_sent and command_can_verify_actuation(vx, vy, wz):
                self._verify_actuation(last_dispatch)

    async def _abort_motion(self, error: str, cancel_route: bool) -> None:
        with self.lock:
            self.motion_active = False
            self.control_mode = "disabled"
        self.nav2.set_control_mode("disabled")
        if cancel_route:
            try:
                await asyncio.to_thread(self.nav2.cancel, False)
            except Exception:
                pass
            self.nav2.fail(error)
        async with self._motion_lock:
            await self._send_velocity(0.0, 0.0, 0.0)

    def _verify_actuation(self, dispatched_at: float) -> None:
        with self.lock:
            odom_pose = dict(self._base_odom_pose) if self._base_odom_pose else None
            if not self._actuation_probe_at and odom_pose:
                self._actuation_probe_at = dispatched_at
                self._actuation_probe_pose = odom_pose
            probe_at = self._actuation_probe_at
            probe_pose = dict(self._actuation_probe_pose) if self._actuation_probe_pose else None
            verified = self._actuation_verified
        if not probe_pose or not odom_pose or verified:
            return
        moved = math.hypot(odom_pose["x"] - probe_pose["x"], odom_pose["y"] - probe_pose["y"])
        turned = abs((odom_pose["yaw"] - probe_pose["yaw"] + math.pi) % (2.0 * math.pi) - math.pi)
        if moved >= 0.04 or turned >= 0.08:
            with self.lock:
                self._actuation_verified = True
        elif dispatched_at - probe_at >= NAV_PROGRESS_TIMEOUT:
            # Robotul acceptă 7105 dar pelvisul nu se mișcă → autoritate/FSM.
            self.nav2.fail(
                "API 7105 acceptă viteza, dar odom_pelvis nu arată mișcare; "
                "verifică autoritatea locomotorie/FSM"
            )
            with self.lock:
                self.motion_active = False
                self.control_mode = "disabled"
            self.nav2.set_control_mode("disabled")

    def _reset_actuation_probe(self) -> None:
        with self.lock:
            self._actuation_probe_at = 0.0
            self._actuation_probe_pose = None
            self._actuation_verified = False

    # ── API public folosit de endpoint-urile /api/nav ─────────────────────────
    async def preview(self, x: float, y: float, yaw: float, timeout: float = 12.0) -> dict:
        if not self.available:
            return {"success": False, "error": "Motorul Nav2 nu este pornit"}
        health = self.health()
        if health:
            return {"success": False, "error": health}
        try:
            plan = await asyncio.to_thread(self.nav2.compute_path, x, y, yaw, timeout)
        except (RuntimeError, TimeoutError) as exc:
            return {"success": False, "error": str(exc)}
        return {
            "success": True,
            "path": plan["points"],
            "distance": plan["distance"],
            "planner": "Nav2 GridBased",
            "executor": "nav2",
            "goal": {"x": x, "y": y, "yaw": yaw},
        }

    async def goal(self, x: float, y: float, yaw: float, speed: float) -> dict:
        if not self.available:
            return {"success": False, "error": "Motorul Nav2 nu este pornit"}
        health = self.health()
        if health:
            return {"success": False, "error": health}
        if self.nav2.status()["state"] in Nav2Runtime.ACTIVE_STATES:
            return {"success": False, "error": "Există deja o rută Nav2 activă"}
        # Barieră: viteză zero înainte de a arma o rută nouă.
        with self.lock:
            self.motion_active = False
            self.control_mode = "disabled"
            self.navigation_paused = False
            self.motion_speed_limit = float(speed)
        self.nav2.set_control_mode("disabled")
        async with self._motion_lock:
            await self._send_velocity(0.0, 0.0, 0.0)
        self._reset_actuation_probe()
        with self.lock:
            self.control_mode = "nav2"
        self.nav2.set_control_mode("nav2")
        try:
            target = await asyncio.to_thread(self.nav2.navigate, x, y, yaw, float(speed))
        except (RuntimeError, TimeoutError) as exc:
            with self.lock:
                self.control_mode = "disabled"
            self.nav2.set_control_mode("disabled")
            async with self._motion_lock:
                await self._send_velocity(0.0, 0.0, 0.0)
            return {"success": False, "error": str(exc)}
        with self.lock:
            self.motion_active = True
            self.motion_armed_at = time.monotonic()
        return {"success": True, "goal": target, "executor": "nav2",
                "planner": "Nav2 GridBased", "driver": "nav2"}

    async def pause(self) -> dict:
        if not self.available:
            return {"success": False, "error": "Motorul Nav2 nu este pornit"}
        with self.lock:
            active = self.motion_active
        if not active:
            return {"success": True, "message": "Nicio rută Nav2 activă"}
        try:
            cancelled = await asyncio.to_thread(self.nav2.cancel, True)
        except (RuntimeError, TimeoutError) as exc:
            return {"success": False, "error": str(exc)}
        with self.lock:
            self.navigation_paused = bool(cancelled)
            self.motion_active = False
            self.control_mode = "disabled"
        self.nav2.set_control_mode("disabled")
        async with self._motion_lock:
            await self._send_velocity(0.0, 0.0, 0.0)
        return {"success": True, "cancelled": cancelled, "message": "Ruta Nav2 este în pauză"}

    async def resume(self) -> dict:
        if not self.available:
            return {"success": False, "error": "Motorul Nav2 nu este pornit"}
        with self.lock:
            paused = self.navigation_paused
        if not paused or self.nav2.status()["state"] != "paused":
            return {"success": False, "error": "Nu există o rută Nav2 în pauză"}
        health = self.health()
        if health:
            return {"success": False, "error": health}
        self._reset_actuation_probe()
        with self.lock:
            self.control_mode = "nav2"
        self.nav2.set_control_mode("nav2")
        try:
            target = await asyncio.to_thread(self.nav2.resume)
        except (RuntimeError, TimeoutError) as exc:
            with self.lock:
                self.control_mode = "disabled"
            self.nav2.set_control_mode("disabled")
            return {"success": False, "error": str(exc)}
        with self.lock:
            self.navigation_paused = False
            self.motion_active = True
            self.motion_armed_at = time.monotonic()
        return {"success": True, "goal": target, "message": "Ruta Nav2 a fost reluată"}

    async def stop(self) -> dict:
        """Anulează ruta Nav2 și trimite zero ca barieră."""
        if not self.available:
            return {"success": True, "message": "Motorul Nav2 nu este pornit"}
        try:
            await asyncio.to_thread(self.nav2.cancel, False)
        except Exception:
            pass
        with self.lock:
            self.motion_active = False
            self.navigation_paused = False
            self.control_mode = "disabled"
        self.nav2.set_control_mode("disabled")
        self._reset_actuation_probe()
        async with self._motion_lock:
            result = await self._send_velocity(0.0, 0.0, 0.0)
        return {"success": bool(result.get("success")), "locomotion": result}

    def status(self) -> dict:
        if not self.available:
            return {"available": False, "state": "offline", "driver": "nav2"}
        data = self.nav2.status()
        with self.lock:
            data.update({
                "available": True,
                "motion_active": self.motion_active,
                "navigation_paused": self.navigation_paused,
                "control_mode": self.control_mode,
                "speed_limit": self.motion_speed_limit,
                "map_ready": self.map_ready,
                "pose_age": None if not self._pose_at else round(time.time() - self._pose_at, 3),
                "base_odom_age": None if not self._base_odom_at else round(time.time() - self._base_odom_at, 3),
                "last_forwarded_velocity": list(self.last_forwarded_velocity),
                "last_velocity_accepted": self.last_velocity_accepted,
                "health": self.health(),
            })
        return data


# Instanță unică folosită de server.py.
engine = Nav2Engine()
