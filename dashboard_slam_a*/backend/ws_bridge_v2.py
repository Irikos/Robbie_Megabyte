#!/usr/bin/env python3
"""
ws_bridge_node.py

Simple ROS2 node:
  - Subscribes (statically) to:
      /scan_odom  (nav_msgs/msg/Odometry)
      /path       (nav_msgs/msg/Path)
      /scan       (sensor_msgs/msg/LaserScan)
      /map        (nav_msgs/msg/OccupancyGrid)
    and forwards map-frame data as JSON over a WebSocket connection.
  - Uses the existing map -> odom -> scan -> laser TF chain at each ROS
    timestamp, so motion and WebSocket latency do not distort the live scan.
  - Listens on that same WebSocket connection for "goal_pose" JSON
    messages and publishes them to /goal_pose as
    geometry_msgs/msg/PoseStamped.

NOTE: /scan_odom is assumed to be nav_msgs/msg/Odometry. If it's
actually a different type, change the import/subscription/callback
for that one topic accordingly.

Dependency:
    pip install websockets --break-system-packages

Run:
    export G1_DASHBOARD_TOKEN='<token shown by start_dashboard.sh>'
    export CAR_DASHBOARD_WS_URL='ws://192.168.0.116:3003/ws/car'
    python3 ws_bridge.py
"""

import asyncio
import json
import math
import os
import queue
import threading
import time
from types import SimpleNamespace
from urllib.parse import quote

import rclpy
from rclpy.action import ActionClient
from rclpy.duration import Duration
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from rclpy.time import Time

from nav_msgs.msg import OccupancyGrid, Odometry, Path
from nav2_msgs.action import ComputePathToPose
from sensor_msgs.msg import LaserScan
from geometry_msgs.msg import PoseStamped
from tf2_ros import Buffer, TransformException, TransformListener

import websockets

# ---- Hardcoded config --------------------------------------------------
WS_URL = os.environ.get(
    "CAR_DASHBOARD_WS_URL",
    "ws://192.168.0.116:3003/ws/car",
)
WS_TOKEN = os.environ.get("G1_DASHBOARD_TOKEN", "")
GOAL_POSE_TOPIC = "/goal_pose"
PATH_TOPIC = os.environ.get("CAR_PATH_TOPIC", "/path")
MAP_FRAME = os.environ.get("CAR_MAP_FRAME", "map")
BASE_FRAME = os.environ.get("CAR_BASE_FRAME", "scan")
RECONNECT_INTERVAL_SEC = 3.0
# -------------------------------------------------------------------------


class WsBridgeNode(Node):
    def __init__(self):
        super().__init__('ws_bridge_v2')

        # Thread-safe queue: ROS callbacks -> asyncio ws loop
        self._out_queue: "queue.Queue[str]" = queue.Queue(maxsize=100)

        # Publisher for goal poses coming FROM the websocket server
        self._goal_pose_pub = self.create_publisher(PoseStamped, GOAL_POSE_TOPIC, 10)
        self._compute_path_client = ActionClient(
            self, ComputePathToPose, '/compute_path_to_pose'
        )
        self._server_commands: "queue.Queue[dict]" = queue.Queue(maxsize=10)

        # The supplied navigation stack publishes map -> odom (AMCL),
        # odom -> scan (odom_bc), and scan -> laser (static transform).
        self._tf_buffer = Buffer(cache_time=Duration(seconds=10.0))
        self._tf_listener = TransformListener(self._tf_buffer, self)
        self._pending_scan = None
        self._pending_scan_received_at = 0.0
        self._pending_odom = None
        self._pending_odom_received_at = 0.0
        self._last_tf_warning = 0.0
        self._latest_map_data = None

        # ---- Static subscriptions ----------------------------------
        self.create_subscription(Odometry, '/scan_odom', self.scan_odom_callback, 10)
        self.create_subscription(Path, PATH_TOPIC, self.path_callback, 10)
        self.create_subscription(LaserScan, '/scan', self.scan_callback, 10)
        map_qos = QoSProfile(
            depth=1,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
            reliability=ReliabilityPolicy.RELIABLE,
        )
        self.create_subscription(OccupancyGrid, '/map', self.map_callback, map_qos)
        self.create_timer(0.03, self._process_pending_tf_data)

        # Websocket client runs in its own thread/event loop so it never
        # blocks rclpy spinning.
        self._loop = asyncio.new_event_loop()
        threading.Thread(target=self._run_ws_loop, daemon=True).start()

        self.get_logger().info(
            f'ws_bridge_v2 started, target server: {WS_URL}; '
            f'map frame: {MAP_FRAME}; path topic: {PATH_TOPIC}'
        )

    # ---- Static callbacks -------------------------------------------
    def scan_odom_callback(self, msg: Odometry):
        self._pending_odom = msg
        self._pending_odom_received_at = time.monotonic()

    def _publish_map_pose(self, msg: Odometry, transform):
        translation = transform.transform.translation
        rotation = transform.transform.rotation
        lin = msg.twist.twist.linear
        ang = msg.twist.twist.angular
        self._enqueue('/scan_odom', {
            'frame_id': MAP_FRAME,
            'position': {
                'x': translation.x, 'y': translation.y, 'z': translation.z,
            },
            'orientation': {
                'x': rotation.x, 'y': rotation.y,
                'z': rotation.z, 'w': rotation.w,
            },
            'linear_velocity': {'x': lin.x, 'y': lin.y, 'z': lin.z},
            'angular_velocity': {'x': ang.x, 'y': ang.y, 'z': ang.z},
        })

    def path_callback(self, msg: Path):
        source_frame = msg.header.frame_id or MAP_FRAME
        frame_transform = None
        if source_frame != MAP_FRAME:
            frame_transform = self._lookup_map_transform(source_frame, msg.header.stamp)
            if frame_transform is None:
                self._warn_tf(f'Nu pot transforma traseul {source_frame} -> {MAP_FRAME}')
                return
        poses = []
        for pose_stamped in msg.poses:
            p = pose_stamped.pose.position
            o = pose_stamped.pose.orientation
            if frame_transform is not None:
                p, o = self._transform_pose_2d(p, o, frame_transform)
            poses.append({
                'position': {'x': p.x, 'y': p.y, 'z': p.z},
                'orientation': {'x': o.x, 'y': o.y, 'z': o.z, 'w': o.w},
            })
        self._enqueue('/path', {
            'frame_id': MAP_FRAME,
            'poses': poses,
        })

    def scan_callback(self, msg: LaserScan):
        self._pending_scan = msg
        self._pending_scan_received_at = time.monotonic()

    def _publish_map_scan(self, msg: LaserScan, transform):
        translation = transform.transform.translation
        tf_yaw = self._yaw_from_quaternion(transform.transform.rotation)
        cos_tf, sin_tf = math.cos(tf_yaw), math.sin(tf_yaw)
        step = max(1, math.ceil(len(msg.ranges) / 1200))
        points = []
        for index in range(0, len(msg.ranges), step):
            distance = float(msg.ranges[index])
            if (
                not math.isfinite(distance)
                or distance < max(0.0, float(msg.range_min))
                or distance > float(msg.range_max)
            ):
                continue
            angle = float(msg.angle_min) + index * float(msg.angle_increment)
            local_x = distance * math.cos(angle)
            local_y = distance * math.sin(angle)
            points.append({
                'x': translation.x + cos_tf * local_x - sin_tf * local_y,
                'y': translation.y + sin_tf * local_x + cos_tf * local_y,
            })
        self._enqueue('/scan_points', {
            'frame_id': MAP_FRAME,
            'source_frame': msg.header.frame_id,
            'points': points,
        })

    def map_callback(self, msg: OccupancyGrid):
        frame_id = msg.header.frame_id or MAP_FRAME
        if frame_id != MAP_FRAME:
            self._warn_tf(f'Harta este în {frame_id}, nu în cadrul configurat {MAP_FRAME}')
            return
        occupied_indices = [
            index for index, value in enumerate(msg.data) if int(value) >= 50
        ]
        origin = msg.info.origin
        map_data = {
            'frame_id': frame_id,
            'width': int(msg.info.width),
            'height': int(msg.info.height),
            'resolution': float(msg.info.resolution),
            'origin': {
                'position': {
                    'x': origin.position.x,
                    'y': origin.position.y,
                    'z': origin.position.z,
                },
                'orientation': {
                    'x': origin.orientation.x,
                    'y': origin.orientation.y,
                    'z': origin.orientation.z,
                    'w': origin.orientation.w,
                },
            },
            'occupied_indices': occupied_indices,
        }
        self._latest_map_data = map_data
        self._enqueue('/map', map_data)

    def _process_pending_tf_data(self):
        self._process_server_commands()
        if self._pending_odom is not None:
            msg = self._pending_odom
            source_frame = msg.child_frame_id or BASE_FRAME
            transform = self._lookup_map_transform(source_frame, msg.header.stamp)
            if transform is not None:
                self._pending_odom = None
                self._publish_map_pose(msg, transform)
            elif time.monotonic() - self._pending_odom_received_at > 0.5:
                self._pending_odom = None
                self._warn_tf(f'Lipsea TF {MAP_FRAME} <- {source_frame} pentru odometrie')

        if self._pending_scan is not None:
            msg = self._pending_scan
            source_frame = msg.header.frame_id or 'laser'
            transform = self._lookup_map_transform(source_frame, msg.header.stamp)
            if transform is not None:
                self._pending_scan = None
                self._publish_map_scan(msg, transform)
            elif time.monotonic() - self._pending_scan_received_at > 0.5:
                self._pending_scan = None
                self._warn_tf(f'Lipsea TF {MAP_FRAME} <- {source_frame} pentru scan')

    def _lookup_map_transform(self, source_frame, stamp):
        try:
            query_time = Time.from_msg(stamp)
            return self._tf_buffer.lookup_transform(
                MAP_FRAME, source_frame, query_time, timeout=Duration()
            )
        except TransformException:
            return None

    def _warn_tf(self, message):
        now = time.monotonic()
        if now - self._last_tf_warning >= 2.0:
            self._last_tf_warning = now
            self.get_logger().warn(message)

    @staticmethod
    def _yaw_from_quaternion(quaternion):
        return math.atan2(
            2.0 * (quaternion.w * quaternion.z + quaternion.x * quaternion.y),
            1.0 - 2.0 * (quaternion.y * quaternion.y + quaternion.z * quaternion.z),
        )

    @staticmethod
    def _quaternion_from_yaw(yaw):
        return SimpleNamespace(
            x=0.0, y=0.0,
            z=math.sin(yaw / 2.0), w=math.cos(yaw / 2.0),
        )

    def _transform_pose_2d(self, position, orientation, transform):
        translation = transform.transform.translation
        transform_yaw = self._yaw_from_quaternion(transform.transform.rotation)
        pose_yaw = self._yaw_from_quaternion(orientation)
        cos_tf, sin_tf = math.cos(transform_yaw), math.sin(transform_yaw)
        transformed_position = SimpleNamespace(
            x=translation.x + cos_tf * position.x - sin_tf * position.y,
            y=translation.y + sin_tf * position.x + cos_tf * position.y,
            z=translation.z + position.z,
        )
        return transformed_position, self._quaternion_from_yaw(transform_yaw + pose_yaw)

    def _enqueue(self, topic_name: str, data: dict):
        try:
            payload = {
                'topic': topic_name,
                'stamp': time.time(),
                'data': data,
            }
            serialized = json.dumps(payload, default=str)
            try:
                self._out_queue.put_nowait(serialized)
            except queue.Full:
                try:
                    self._out_queue.get_nowait()
                except queue.Empty:
                    pass
                try:
                    self._out_queue.put_nowait(serialized)
                except queue.Full:
                    pass
        except Exception as exc:
            self.get_logger().error(f'Failed to serialize message on {topic_name}: {exc}')

    # ---- WebSocket client --------------------------------------------
    def _run_ws_loop(self):
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._ws_main())

    async def _ws_main(self):
        while rclpy.ok():
            try:
                separator = '&' if '?' in WS_URL else '?'
                authenticated_url = (
                    f"{WS_URL}{separator}token={quote(WS_TOKEN)}"
                    if WS_TOKEN else WS_URL
                )
                async with websockets.connect(authenticated_url) as ws:
                    self.get_logger().info(f'Connected to WS server at {WS_URL}')
                    if self._latest_map_data is not None:
                        self._enqueue('/map', self._latest_map_data)
                    await asyncio.gather(self._ws_sender(ws), self._ws_receiver(ws))
            except Exception as exc:
                self.get_logger().warn(f'WS connection error: {exc}. Retrying in {RECONNECT_INTERVAL_SEC}s')
                await asyncio.sleep(RECONNECT_INTERVAL_SEC)

    async def _ws_sender(self, ws):
        while True:
            try:
                message = self._out_queue.get_nowait()
                await ws.send(message)
            except queue.Empty:
                await asyncio.sleep(0.05)

    async def _ws_receiver(self, ws):
        async for raw in ws:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                self.get_logger().warn(f'Received non-JSON WS message: {raw!r}')
                continue
            try:
                self._server_commands.put_nowait(data)
            except queue.Full:
                self.get_logger().warn('Coada comenzilor dashboardului este plină')

    def _process_server_commands(self):
        for _ in range(3):
            try:
                data = self._server_commands.get_nowait()
            except queue.Empty:
                return
            self._handle_goal_pose(data)

    def _handle_goal_pose(self, data: dict):
        """
        Expected payload:
        {
          "position": {"x": 1.0, "y": 2.0, "z": 0.0},
          "orientation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0}
        }
        """
        try:
            command_type = data.get('type', 'goal_pose')
            if command_type not in {'goal_pose', 'compute_path'}:
                self.get_logger().warn(f'Comandă WS necunoscută: {command_type}')
                return
            pos = data['position']
            ori = data.get('orientation', {'x': 0.0, 'y': 0.0, 'z': 0.0, 'w': 1.0})

            msg = PoseStamped()
            msg.header.stamp = self.get_clock().now().to_msg()
            msg.header.frame_id = MAP_FRAME
            msg.pose.position.x = float(pos['x'])
            msg.pose.position.y = float(pos['y'])
            msg.pose.position.z = float(pos.get('z', 0.0))
            msg.pose.orientation.x = float(ori.get('x', 0.0))
            msg.pose.orientation.y = float(ori.get('y', 0.0))
            msg.pose.orientation.z = float(ori.get('z', 0.0))
            msg.pose.orientation.w = float(ori.get('w', 1.0))

            if command_type == 'goal_pose':
                self._goal_pose_pub.publish(msg)
                self.get_logger().info(f'Published goal pose to {GOAL_POSE_TOPIC}')
            self._request_path(msg, data.get('request_id'))
        except (KeyError, TypeError, ValueError) as exc:
            self.get_logger().error(f'Malformed goal_pose payload: {exc}')

    def _request_path(self, goal_pose: PoseStamped, request_id=None):
        if not self._compute_path_client.server_is_ready():
            self._enqueue('/path_status', {
                'status': 'error',
                'request_id': request_id,
                'error': 'Acțiunea /compute_path_to_pose nu este disponibilă',
            })
            return
        request = ComputePathToPose.Goal()
        request.goal = goal_pose
        request.planner_id = ''
        request.use_start = False
        self._enqueue('/path_status', {
            'status': 'planning', 'request_id': request_id,
        })
        future = self._compute_path_client.send_goal_async(request)
        future.add_done_callback(
            lambda completed: self._path_goal_response(completed, request_id)
        )

    def _path_goal_response(self, future, request_id):
        try:
            goal_handle = future.result()
            if not goal_handle.accepted:
                self._enqueue('/path_status', {
                    'status': 'error',
                    'request_id': request_id,
                    'error': 'Plannerul Nav2 a respins cererea de traseu',
                })
                return
            result_future = goal_handle.get_result_async()
            result_future.add_done_callback(
                lambda completed: self._path_result(completed, request_id)
            )
        except Exception as exc:
            self._enqueue('/path_status', {
                'status': 'error', 'request_id': request_id, 'error': str(exc),
            })

    def _path_result(self, future, request_id):
        try:
            path = future.result().result.path
            self.path_callback(path)
            self._enqueue('/path_status', {
                'status': 'ready',
                'request_id': request_id,
                'points': len(path.poses),
            })
        except Exception as exc:
            self._enqueue('/path_status', {
                'status': 'error', 'request_id': request_id, 'error': str(exc),
            })


def main(args=None):
    rclpy.init(args=args)
    node = WsBridgeNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
