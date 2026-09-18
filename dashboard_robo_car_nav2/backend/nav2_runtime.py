"""Interfața ROS 2 minimă dintre dashboard și Nav2.

Modulul nu cunoaște API-urile Unitree. El publică numai harta, odometria și
TF-urile cerute de Nav2, filtrează scanul LiDAR și folosește acțiunile standard
ComputePathToPose/NavigateToPose. Ieșirea de mișcare se termină în
``/nav2/cmd_vel_safe`` și este preluată separat de adaptorul de locomoție.
"""

from __future__ import annotations

import math
import threading
import time
from typing import Any, Callable, Optional

from action_msgs.msg import GoalStatus
from builtin_interfaces.msg import Duration
from geometry_msgs.msg import PoseStamped, TransformStamped, Twist
from nav_msgs.msg import OccupancyGrid, Odometry
from nav2_msgs.action import ComputePathToPose, NavigateToPose, Spin
from nav2_msgs.msg import SpeedLimit
from rclpy.action import ActionClient
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from sensor_msgs.msg import LaserScan
from tf2_ros import StaticTransformBroadcaster, TransformBroadcaster


def wrap_angle(value: float) -> float:
    return (float(value) + math.pi) % (2.0 * math.pi) - math.pi


def quaternion_yaw(quaternion) -> float:
    return math.atan2(
        2.0 * (quaternion.w * quaternion.z + quaternion.x * quaternion.y),
        1.0 - 2.0 * (quaternion.y * quaternion.y + quaternion.z * quaternion.z),
    )


def occupancy_from_points(
    points: list[tuple[float, float, float]],
    resolution: float = 0.05,
    clear_xy: Optional[tuple[float, float]] = None,
) -> dict[str, Any]:
    """Rasterizează punctele 2D o singură dată, fără inflație proprie.

    PCD-ul este o hartă de contururi, deci interiorul dreptunghiului observat
    este liber, punctele sunt ocupate, iar marginea rasterului este închisă.
    Inflația corpului este responsabilitatea exclusivă a costmap-ului Nav2.
    """
    finite = [(float(x), float(y)) for x, y, _z in points if math.isfinite(x) and math.isfinite(y)]
    if not finite:
        raise ValueError("Harta 2D nu conține puncte finite")
    cells = {(math.floor(x / resolution), math.floor(y / resolution)) for x, y in finite}
    min_cell_x = min(x for x, _ in cells) - 10
    max_cell_x = max(x for x, _ in cells) + 10
    min_cell_y = min(y for _, y in cells) - 10
    max_cell_y = max(y for _, y in cells) + 10
    width = max_cell_x - min_cell_x + 1
    height = max_cell_y - min_cell_y + 1
    if width * height > 16_000_000:
        raise ValueError(f"Harta rasterizată este prea mare: {width}x{height}")

    data = [0] * (width * height)

    def index(cell_x: int, cell_y: int) -> Optional[int]:
        if min_cell_x <= cell_x <= max_cell_x and min_cell_y <= cell_y <= max_cell_y:
            return (cell_y - min_cell_y) * width + cell_x - min_cell_x
        return None

    for cell_x, cell_y in cells:
        data[index(cell_x, cell_y)] = 100
    # Nu permitem planificatorului să ocolească un perete ieșind din hartă.
    for x in range(width):
        data[x] = 100
        data[(height - 1) * width + x] = 100
    for y in range(height):
        data[y * width] = 100
        data[y * width + width - 1] = 100

    # Ștergem strict amprenta ocupată deja fizic de robot; nu creăm o zonă
    # artificială mare în jurul lui și nu relaxăm verificarea destinației.
    if clear_xy is not None:
        clear_x = round(clear_xy[0] / resolution)
        clear_y = round(clear_xy[1] / resolution)
        radius_cells = math.ceil(0.34 / resolution)
        for dx in range(-radius_cells, radius_cells + 1):
            for dy in range(-radius_cells, radius_cells + 1):
                if math.hypot(dx * resolution, dy * resolution) > 0.34:
                    continue
                offset = index(clear_x + dx, clear_y + dy)
                if offset is not None:
                    data[offset] = 0

    return {
        "width": width,
        "height": height,
        "resolution": resolution,
        "origin_x": min_cell_x * resolution,
        "origin_y": min_cell_y * resolution,
        "data": data,
        "occupied": sum(value == 100 for value in data),
    }


class Nav2Runtime:
    """Ține integrarea Nav2 izolată de SLAM-ul și HTTP-ul dashboardului."""

    # RegulatedPurePursuitController din Nav2 Humble nu are deloc suport
    # pentru rotația către orientarea finală a goal-ului (nu există
    # use_final_approach_orientation în acest build) — el rotește numai
    # spre punctul de pe traseu, niciodată spre yaw-ul cerut. De aceea
    # orientarea finală este executată separat, explicit, prin acțiunea
    # Spin a behavior_server-ului, DUPĂ ce FollowPath termină pe poziție.
    ACTIVE_STATES = {"starting", "navigating", "orienting"}
    FINAL_YAW_TOLERANCE = 0.12
    # Trebuie să rămână ≤ min_rotational_vel din behavior_server (nav2.yaml),
    # altfel time_allowance calculat aici este optimist față de ce poate
    # produce efectiv Spin.
    SPIN_MIN_ANGULAR_VEL = 0.35

    def __init__(self, node, state_callback: Optional[Callable[[dict], None]] = None):
        self.node = node
        self.state_callback = state_callback
        self.lock = threading.RLock()
        self.tf = TransformBroadcaster(node)
        self.static_tf = StaticTransformBroadcaster(node)
        transient = QoSProfile(
            depth=1,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
        )
        scan_qos = QoSProfile(
            depth=5,
            reliability=ReliabilityPolicy.BEST_EFFORT,
            durability=DurabilityPolicy.VOLATILE,
        )
        self.map_publisher = node.create_publisher(OccupancyGrid, "/map", transient)
        self.odom_publisher = node.create_publisher(Odometry, "/odom", 10)
        self.scan_publisher = node.create_publisher(LaserScan, "/scan", scan_qos)
        self.speed_publisher = node.create_publisher(SpeedLimit, "/speed_limit", transient)
        self.raw_cmd_publisher = node.create_publisher(Twist, "/nav2/cmd_vel_raw", 10)
        self.compute_client = ActionClient(node, ComputePathToPose, "/compute_path_to_pose")
        self.navigate_client = ActionClient(node, NavigateToPose, "/navigate_to_pose")
        self.spin_client = ActionClient(node, Spin, "/spin")
        self.scan_subscription = node.create_subscription(
            LaserScan, "/scan_raw", self._filter_scan, scan_qos
        )
        self.safe_cmd_subscription = node.create_subscription(
            Twist, "/nav2/cmd_vel_safe", self._safe_cmd, 10
        )
        self.smoothed_cmd_subscription = node.create_subscription(
            Twist, "/nav2/cmd_vel_smoothed", self._smoothed_cmd, 10
        )
        self.nav_cmd_subscription = node.create_subscription(
            Twist, "/nav2/cmd_vel_nav2", lambda message: self._source_cmd("nav2", message), 10
        )
        self.teleop_cmd_subscription = node.create_subscription(
            Twist, "/cmd_vel_teleop", lambda message: self._source_cmd("teleop", message), 10
        )
        self._local_pose: Optional[dict[str, float]] = None
        self._map_pose: Optional[dict[str, float]] = None
        self._map_to_odom: Optional[dict[str, float]] = None
        self._map_spec: Optional[dict[str, Any]] = None
        self._scan_at = 0.0
        self._front_clearance: Optional[float] = None
        self._safe_cmd_at = 0.0
        self._safe_velocity = (0.0, 0.0, 0.0)
        self._raw_cmd_at = 0.0
        self._raw_velocity = (0.0, 0.0, 0.0)
        self._smoothed_cmd_at = 0.0
        self._smoothed_velocity = (0.0, 0.0, 0.0)
        self._smooth_stop_at = 0.0
        self._smooth_stop_active = False
        self._control_mode = "disabled"
        self._source_cmd_at = {"nav2": 0.0, "teleop": 0.0}
        self._source_velocity = {
            "nav2": (0.0, 0.0, 0.0),
            "teleop": (0.0, 0.0, 0.0),
        }
        self._goal_handle = None
        self._paused_goal: Optional[dict[str, float]] = None
        self._forced_failure = ""
        self._status = {
            "state": "idle",
            "message": "Nav2 este în așteptare",
            "driver": "nav2",
            "goal": None,
            "path": [],
            "remaining": None,
            "recoveries": 0,
        }
        self._publish_static_transforms()

    def _publish_static_transforms(self) -> None:
        stamp = self.node.get_clock().now().to_msg()
        torso = TransformStamped()
        torso.header.stamp = stamp
        torso.header.frame_id = "base_link"
        torso.child_frame_id = "torso_link"
        torso.transform.translation.x = -0.0039635
        torso.transform.translation.z = 0.054
        torso.transform.rotation.w = 1.0
        lidar = TransformStamped()
        lidar.header.stamp = stamp
        lidar.header.frame_id = "torso_link"
        lidar.child_frame_id = "livox_frame"
        lidar.transform.translation.x = 0.0002835
        lidar.transform.translation.y = 0.00003
        lidar.transform.translation.z = 0.40618
        roll, pitch = 3.14, 0.04014257279586953
        cr, sr = math.cos(roll / 2.0), math.sin(roll / 2.0)
        cp, sp = math.cos(pitch / 2.0), math.sin(pitch / 2.0)
        lidar.transform.rotation.x = sr * cp
        lidar.transform.rotation.y = cr * sp
        lidar.transform.rotation.z = -sr * sp
        lidar.transform.rotation.w = cr * cp
        self.static_tf.sendTransform([torso, lidar])

    def _set_status(self, **values: Any) -> None:
        with self.lock:
            self._status.update(values)
            snapshot = dict(self._status)
        if self.state_callback:
            self.state_callback(snapshot)

    def fail(self, message: str) -> None:
        with self.lock:
            self._forced_failure = str(message)
        self._set_status(state="failed", message=str(message), remaining=None)

    def status(self) -> dict[str, Any]:
        with self.lock:
            result = dict(self._status)
            result["scan_age"] = None if not self._scan_at else round(time.monotonic() - self._scan_at, 3)
            result["front_clearance"] = self._front_clearance
            result["safe_cmd_age"] = None if not self._safe_cmd_at else round(time.monotonic() - self._safe_cmd_at, 3)
            result["safe_velocity"] = list(self._safe_velocity)
            result["raw_cmd_age"] = None if not self._raw_cmd_at else round(time.monotonic() - self._raw_cmd_at, 3)
            result["raw_velocity"] = list(self._raw_velocity)
            result["smoothed_cmd_age"] = None if not self._smoothed_cmd_at else round(time.monotonic() - self._smoothed_cmd_at, 3)
            result["smoothed_velocity"] = list(self._smoothed_velocity)
            result["smooth_stop_active"] = self._smooth_stop_active
            result["map_ready"] = self._map_spec is not None
            result["tf_ready"] = self._map_to_odom is not None
            result["control_mode"] = self._control_mode
            result["teleop_cmd_age"] = (
                None if not self._source_cmd_at["teleop"]
                else round(time.monotonic() - self._source_cmd_at["teleop"], 3)
            )
            result["teleop_velocity"] = list(self._source_velocity["teleop"])
            result["nav2_cmd_age"] = (
                None if not self._source_cmd_at["nav2"]
                else round(time.monotonic() - self._source_cmd_at["nav2"], 3)
            )
            result["nav2_velocity"] = list(self._source_velocity["nav2"])
            return result

    def safe_velocity(self) -> tuple[tuple[float, float, float], float]:
        with self.lock:
            return self._safe_velocity, self._safe_cmd_at

    def source_velocity(self, source: str) -> tuple[tuple[float, float, float], float]:
        if source not in self._source_velocity:
            raise ValueError(f"Sursă cmd_vel invalidă: {source}")
        with self.lock:
            return self._source_velocity[source], self._source_cmd_at[source]

    def _safe_cmd(self, message: Twist) -> None:
        values = (float(message.linear.x), float(message.linear.y), float(message.angular.z))
        if not all(math.isfinite(value) for value in values):
            values = (0.0, 0.0, 0.0)
        with self.lock:
            self._safe_velocity = values
            self._safe_cmd_at = time.monotonic()

    def _smoothed_cmd(self, message: Twist) -> None:
        values = (float(message.linear.x), float(message.linear.y), float(message.angular.z))
        if not all(math.isfinite(value) for value in values):
            values = (0.0, 0.0, 0.0)
        with self.lock:
            self._smoothed_velocity = values
            self._smoothed_cmd_at = time.monotonic()

    def set_control_mode(self, mode: str) -> None:
        if mode not in {"disabled", "teleop", "nav2"}:
            raise ValueError(f"Mod cmd_vel invalid: {mode}")
        with self.lock:
            self._control_mode = mode
            self._safe_velocity = (0.0, 0.0, 0.0)
            self._safe_cmd_at = 0.0
            self._raw_velocity = (0.0, 0.0, 0.0)
            self._raw_cmd_at = 0.0
            self._smoothed_velocity = (0.0, 0.0, 0.0)
            self._smoothed_cmd_at = 0.0
            self._smooth_stop_at = 0.0
            self._smooth_stop_active = False
            if mode in self._source_velocity:
                # O sesiune nouă nu moștenește ultima tastă sau ultima comandă
                # Nav2 de la sursa selectată anterior.
                self._source_velocity[mode] = (0.0, 0.0, 0.0)
                self._source_cmd_at[mode] = 0.0
        self.raw_cmd_publisher.publish(Twist())

    def _source_cmd(self, source: str, message: Twist) -> None:
        values = (float(message.linear.x), float(message.linear.y), float(message.angular.z))
        if not all(math.isfinite(value) for value in values):
            values = (0.0, 0.0, 0.0)
        with self.lock:
            self._source_cmd_at[source] = time.monotonic()
            self._source_velocity[source] = values
            selected = self._control_mode == source
            if source == "nav2":
                self._smooth_stop_active = False
        # Teleop este consumat direct de adaptorul Sport și nu mai este copiat
        # inutil prin smoother/Collision Monitor. Numai Nav2 publică aici.
        if source == "teleop" or not selected:
            return
        forwarded = Twist()
        forwarded.linear.x, forwarded.linear.y = values[0], values[1]
        forwarded.angular.z = values[2]
        with self.lock:
            self._raw_velocity = values
            self._raw_cmd_at = time.monotonic()
        self.raw_cmd_publisher.publish(forwarded)

    def request_smooth_stop(self) -> bool:
        """Injectează numai zero prin același selector și întregul lanț sigur.

        Când controllerul tace în timpul replanificării, zero-ul trece prin
        velocity_smoother și Collision Monitor. Nu se creează un al doilea
        publisher către robot și nu se ocolește filtrul de coliziune.
        """
        now = time.monotonic()
        with self.lock:
            if self._control_mode != "nav2":
                return False
            # Un singur zero stabilește ținta de oprire; smoother-ul publică
            # singur rampa. Repetarea zeroului nu aduce siguranță suplimentară
            # și poate concura cu reluarea controllerului.
            if self._smooth_stop_active:
                return False
            if now - self._smooth_stop_at < 0.08:
                return False
            self._smooth_stop_at = now
            self._smooth_stop_active = True
            self._raw_velocity = (0.0, 0.0, 0.0)
            self._raw_cmd_at = now
        self.raw_cmd_publisher.publish(Twist())
        return True

    def _filter_scan(self, source: LaserScan) -> None:
        filtered = LaserScan()
        filtered.header = source.header
        filtered.header.frame_id = "base_link"
        filtered.angle_min = source.angle_min
        filtered.angle_max = source.angle_max
        filtered.angle_increment = source.angle_increment
        filtered.time_increment = source.time_increment
        filtered.scan_time = source.scan_time
        filtered.range_min = source.range_min
        filtered.range_max = source.range_max
        filtered.intensities = list(source.intensities)
        ranges = list(source.ranges)
        front_clearance = math.inf
        for index, distance in enumerate(ranges):
            if not math.isfinite(distance):
                continue
            angle = source.angle_min + index * source.angle_increment
            x = distance * math.cos(angle)
            y = distance * math.sin(angle)
            if -0.30 <= x <= 0.38 and abs(y) <= 0.34:
                ranges[index] = math.inf
            elif x > 0.0 and abs(y) <= 0.35:
                front_clearance = min(front_clearance, x)
        filtered.ranges = ranges
        self.scan_publisher.publish(filtered)
        with self.lock:
            self._scan_at = time.monotonic()
            self._front_clearance = None if math.isinf(front_clearance) else front_clearance

    def publish_map(
        self,
        points: list[tuple[float, float, float]],
        clear_xy: Optional[tuple[float, float]] = None,
    ) -> dict[str, Any]:
        spec = occupancy_from_points(points, clear_xy=clear_xy)
        message = OccupancyGrid()
        message.header.stamp = self.node.get_clock().now().to_msg()
        message.header.frame_id = "map"
        message.info.map_load_time = message.header.stamp
        message.info.resolution = spec["resolution"]
        message.info.width = spec["width"]
        message.info.height = spec["height"]
        message.info.origin.position.x = spec["origin_x"]
        message.info.origin.position.y = spec["origin_y"]
        message.info.origin.orientation.w = 1.0
        message.data = spec["data"]
        self.map_publisher.publish(message)
        with self.lock:
            self._map_spec = {key: value for key, value in spec.items() if key != "data"}
        return dict(self._map_spec)

    def update_map_pose(self, pose: dict[str, float]) -> None:
        with self.lock:
            self._map_pose = dict(pose)
            self._update_anchor_locked()

    def update_local_odometry(self, source: Odometry) -> None:
        pose = source.pose.pose
        local = {
            "x": float(pose.position.x),
            "y": float(pose.position.y),
            "yaw": quaternion_yaw(pose.orientation),
        }
        stamp = self.node.get_clock().now().to_msg()
        normalized = Odometry()
        normalized.header.stamp = stamp
        normalized.header.frame_id = "odom"
        normalized.child_frame_id = "base_link"
        normalized.pose = source.pose
        normalized.twist = source.twist
        self.odom_publisher.publish(normalized)
        odom_tf = TransformStamped()
        odom_tf.header.stamp = stamp
        odom_tf.header.frame_id = "odom"
        odom_tf.child_frame_id = "base_link"
        odom_tf.transform.translation.x = local["x"]
        odom_tf.transform.translation.y = local["y"]
        odom_tf.transform.rotation.z = math.sin(local["yaw"] / 2.0)
        odom_tf.transform.rotation.w = math.cos(local["yaw"] / 2.0)
        with self.lock:
            self._local_pose = local
            self._update_anchor_locked()
            anchor = dict(self._map_to_odom) if self._map_to_odom else None
        transforms = [odom_tf]
        if anchor:
            transforms.insert(0, self._anchor_transform(anchor, stamp))
        self.tf.sendTransform(transforms)

    def _update_anchor_locked(self) -> None:
        if not self._map_pose or not self._local_pose:
            return
        yaw = wrap_angle(self._map_pose["yaw"] - self._local_pose["yaw"])
        cosine, sine = math.cos(yaw), math.sin(yaw)
        self._map_to_odom = {
            "x": self._map_pose["x"] - cosine * self._local_pose["x"] + sine * self._local_pose["y"],
            "y": self._map_pose["y"] - sine * self._local_pose["x"] - cosine * self._local_pose["y"],
            "yaw": yaw,
        }

    @staticmethod
    def _anchor_transform(anchor: dict[str, float], stamp) -> TransformStamped:
        transform = TransformStamped()
        transform.header.stamp = stamp
        transform.header.frame_id = "map"
        transform.child_frame_id = "odom"
        transform.transform.translation.x = anchor["x"]
        transform.transform.translation.y = anchor["y"]
        transform.transform.rotation.z = math.sin(anchor["yaw"] / 2.0)
        transform.transform.rotation.w = math.cos(anchor["yaw"] / 2.0)
        return transform

    def health_error(self) -> str:
        state = self.status()
        if not state["map_ready"]:
            return "Harta Nav2 nu este publicată"
        if not state["tf_ready"]:
            return "Transformarea map→odom nu este încă disponibilă"
        if state["scan_age"] is None or state["scan_age"] > 0.6:
            return "Scanul LiDAR /scan nu este proaspăt"
        return ""

    def _pose(self, x: float, y: float, yaw: float) -> PoseStamped:
        message = PoseStamped()
        message.header.stamp = self.node.get_clock().now().to_msg()
        message.header.frame_id = "map"
        message.pose.position.x = float(x)
        message.pose.position.y = float(y)
        message.pose.orientation.z = math.sin(float(yaw) / 2.0)
        message.pose.orientation.w = math.cos(float(yaw) / 2.0)
        return message

    @staticmethod
    def _wait_future(future, timeout: float):
        completed = threading.Event()
        future.add_done_callback(lambda _future: completed.set())
        if not completed.wait(timeout):
            raise TimeoutError("Nav2 nu a răspuns în timpul alocat")
        exception = future.exception()
        if exception:
            raise exception
        return future.result()

    def compute_path(self, x: float, y: float, yaw: float, timeout: float = 12.0) -> dict[str, Any]:
        if not self.compute_client.wait_for_server(timeout_sec=2.0):
            raise RuntimeError("Acțiunea Nav2 /compute_path_to_pose nu este disponibilă")
        goal = ComputePathToPose.Goal()
        goal.goal = self._pose(x, y, yaw)
        goal.planner_id = "GridBased"
        goal.use_start = False
        handle = self._wait_future(self.compute_client.send_goal_async(goal), 3.0)
        if not handle.accepted:
            raise RuntimeError("Nav2 a refuzat calculul rutei")
        wrapped = self._wait_future(handle.get_result_async(), timeout)
        if wrapped.status != GoalStatus.STATUS_SUCCEEDED:
            raise RuntimeError(f"Nav2 nu a găsit rută (status {wrapped.status})")
        poses = wrapped.result.path.poses
        points = [[float(item.pose.position.x), float(item.pose.position.y)] for item in poses]
        distance = sum(
            math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(points, points[1:])
        )
        self._set_status(state="previewed", message="Ruta Nav2 este pregătită", path=points,
                         remaining=distance, goal={"x": x, "y": y, "yaw": yaw})
        return {"points": points, "distance": distance}

    def set_speed_limit(self, speed: float) -> None:
        message = SpeedLimit()
        message.header.stamp = self.node.get_clock().now().to_msg()
        message.header.frame_id = "base_link"
        message.percentage = False
        message.speed_limit = float(speed)
        self.speed_publisher.publish(message)

    def navigate(self, x: float, y: float, yaw: float, speed: float) -> dict[str, Any]:
        if not self.navigate_client.wait_for_server(timeout_sec=2.0):
            raise RuntimeError("Acțiunea Nav2 /navigate_to_pose nu este disponibilă")
        target = {"x": float(x), "y": float(y), "yaw": float(yaw), "speed": float(speed)}
        goal = NavigateToPose.Goal()
        goal.pose = self._pose(x, y, yaw)
        self.set_speed_limit(speed)
        self._set_status(state="starting", message="Nav2 acceptă destinația", goal=target,
                         remaining=None, recoveries=0)
        handle = self._wait_future(
            self.navigate_client.send_goal_async(goal, feedback_callback=self._feedback), 3.0
        )
        if not handle.accepted:
            self._set_status(state="failed", message="Nav2 a refuzat destinația")
            raise RuntimeError("Nav2 a refuzat destinația")
        with self.lock:
            self._goal_handle = handle
            self._paused_goal = None
            self._forced_failure = ""
        handle.get_result_async().add_done_callback(self._result)
        self._set_status(state="navigating", message="Nav2 urmărește ruta")
        return target

    def _feedback(self, feedback_message) -> None:
        feedback = feedback_message.feedback
        self._set_status(
            state="navigating",
            message="Nav2 urmărește ruta",
            remaining=float(feedback.distance_remaining),
            recoveries=int(feedback.number_of_recoveries),
        )

    def _result(self, future) -> None:
        try:
            wrapped = future.result()
            status = int(wrapped.status)
        except Exception as exc:
            self._set_status(state="failed", message=f"Eroare rezultat Nav2: {exc}")
            return
        with self.lock:
            paused = bool(self._paused_goal)
            forced_failure = self._forced_failure
            self._goal_handle = None
        if forced_failure:
            self._set_status(state="failed", message=forced_failure, remaining=None)
            return
        if status == GoalStatus.STATUS_CANCELED and paused:
            return
        if status == GoalStatus.STATUS_SUCCEEDED:
            # Poziția a fost atinsă; orientarea finală nu este responsabilitatea
            # RPP în Humble, deci o executăm explicit mai jos, prin Spin.
            self._start_final_orientation()
            return
        states = {
            GoalStatus.STATUS_CANCELED: ("cancelled", "Ruta Nav2 a fost oprită"),
            GoalStatus.STATUS_ABORTED: ("failed", "Nav2 a abandonat ruta"),
        }
        state, message = states.get(status, ("failed", f"Nav2 s-a încheiat cu status {status}"))
        self._set_status(state=state, message=message, remaining=None)

    def _start_final_orientation(self) -> None:
        """Rotește explicit spre yaw-ul goal-ului, prin Spin (behavior_server).

        Spin publică pe același topic remapat ca și FollowPath
        (``/nav2/cmd_vel_nav2``), deci trece prin exact același lanț de
        siguranță deja folosit pentru mișcarea liniară: velocity_smoother,
        Collision Monitor, motion_adapter și verificarea din odometrie.
        Nu se creează niciun publisher sau nicio cale nouă către robot.
        """
        with self.lock:
            goal = dict(self._status.get("goal") or {})
            current_yaw = self._map_pose["yaw"] if self._map_pose else None
        goal_yaw = goal.get("yaw")
        if goal_yaw is None or current_yaw is None:
            self._set_status(
                state="completed",
                message="Destinația Nav2 a fost atinsă (fără pozitie/yaw pentru verificarea orientării)",
                remaining=0.0,
            )
            return
        yaw_error = wrap_angle(float(goal_yaw) - float(current_yaw))
        if abs(yaw_error) <= self.FINAL_YAW_TOLERANCE:
            self._set_status(
                state="completed",
                message="Destinația Nav2 a fost atinsă, robotul este deja orientat spre țintă",
                remaining=0.0,
            )
            return
        if not self.spin_client.wait_for_server(timeout_sec=2.0):
            self._set_status(
                state="completed",
                message="Destinația a fost atinsă, dar acțiunea /spin nu este disponibilă pentru orientarea finală",
                remaining=0.0,
            )
            return
        goal_msg = Spin.Goal()
        goal_msg.target_yaw = float(yaw_error)
        allowance = min(15.0, abs(yaw_error) / self.SPIN_MIN_ANGULAR_VEL + 3.0)
        goal_msg.time_allowance = Duration(
            sec=int(allowance), nanosec=int((allowance % 1.0) * 1e9)
        )
        self._set_status(
            state="orienting", message="Nav2 rotește robotul spre orientarea țintei", remaining=None
        )
        future = self.spin_client.send_goal_async(goal_msg)
        future.add_done_callback(self._spin_goal_response)

    def _spin_goal_response(self, future) -> None:
        try:
            handle = future.result()
        except Exception as exc:
            self._set_status(
                state="completed",
                message=f"Destinația a fost atinsă, rotația finală a eșuat: {exc}",
                remaining=0.0,
            )
            return
        if not handle.accepted:
            self._set_status(
                state="completed",
                message="Destinația a fost atinsă, /spin a refuzat rotația finală",
                remaining=0.0,
            )
            return
        with self.lock:
            self._goal_handle = handle
        handle.get_result_async().add_done_callback(self._spin_result)

    def _spin_result(self, future) -> None:
        with self.lock:
            self._goal_handle = None
        try:
            wrapped = future.result()
            status = int(wrapped.status)
        except Exception as exc:
            self._set_status(
                state="completed",
                message=f"Destinația a fost atinsă, rotația finală a eșuat: {exc}",
                remaining=0.0,
            )
            return
        if status == GoalStatus.STATUS_SUCCEEDED:
            self._set_status(
                state="completed",
                message="Destinația Nav2 a fost atinsă, robotul este orientat spre țintă",
                remaining=0.0,
            )
        else:
            self._set_status(
                state="completed",
                message=f"Destinația a fost atinsă, rotația finală s-a încheiat cu status {status}",
                remaining=0.0,
            )

    def cancel(self, pause: bool = False) -> bool:
        with self.lock:
            handle = self._goal_handle
            goal = dict(self._status.get("goal") or {})
        if handle is None:
            return False
        wrapped = self._wait_future(handle.cancel_goal_async(), 3.0)
        accepted = bool(wrapped.goals_canceling)
        with self.lock:
            self._goal_handle = None
            self._paused_goal = goal if pause and accepted else None
        self._set_status(
            state="paused" if pause and accepted else "cancelled",
            message="Ruta Nav2 este în pauză" if pause and accepted else "Ruta Nav2 a fost oprită",
        )
        return accepted

    def resume(self) -> dict[str, Any]:
        with self.lock:
            goal = dict(self._paused_goal or {})
        if not goal:
            raise RuntimeError("Nu există o destinație Nav2 în pauză")
        return self.navigate(**goal)
