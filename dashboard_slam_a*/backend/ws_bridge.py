#!/usr/bin/env python3
"""
ws_bridge_node.py

Simple ROS2 node:
  - Subscribes (statically) to:
      /scan_odom  (nav_msgs/msg/Odometry)
      /path       (nav_msgs/msg/Path)
      /scan       (sensor_msgs/msg/LaserScan)
    and forwards each message as JSON over a WebSocket connection.
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
import os
import queue
import threading
import time
from urllib.parse import quote

import rclpy
from rclpy.node import Node

from nav_msgs.msg import Odometry, Path
from sensor_msgs.msg import LaserScan
from geometry_msgs.msg import PoseStamped

import websockets

# ---- Hardcoded config --------------------------------------------------
WS_URL = os.environ.get(
    "CAR_DASHBOARD_WS_URL",
    "ws://192.168.0.116:3003/ws/car",
)
WS_TOKEN = os.environ.get("G1_DASHBOARD_TOKEN", "")
GOAL_POSE_TOPIC = "/goal_pose"
RECONNECT_INTERVAL_SEC = 3.0
# -------------------------------------------------------------------------


class WsBridgeNode(Node):
    def __init__(self):
        super().__init__('ws_bridge_node')

        # Thread-safe queue: ROS callbacks -> asyncio ws loop
        self._out_queue: "queue.Queue[str]" = queue.Queue(maxsize=100)

        # Publisher for goal poses coming FROM the websocket server
        self._goal_pose_pub = self.create_publisher(PoseStamped, GOAL_POSE_TOPIC, 10)

        # ---- Static subscriptions ----------------------------------
        self.create_subscription(Odometry, '/scan_odom', self.scan_odom_callback, 10)
        self.create_subscription(Path, '/path', self.path_callback, 10)
        self.create_subscription(LaserScan, '/scan', self.scan_callback, 10)

        # Websocket client runs in its own thread/event loop so it never
        # blocks rclpy spinning.
        self._loop = asyncio.new_event_loop()
        threading.Thread(target=self._run_ws_loop, daemon=True).start()

        self.get_logger().info(f'ws_bridge_node started, target server: {WS_URL}')

    # ---- Static callbacks -------------------------------------------
    def scan_odom_callback(self, msg: Odometry):
        pos = msg.pose.pose.position
        ori = msg.pose.pose.orientation
        lin = msg.twist.twist.linear
        ang = msg.twist.twist.angular
        self._enqueue('/scan_odom', {
            'position': {'x': pos.x, 'y': pos.y, 'z': pos.z},
            'orientation': {'x': ori.x, 'y': ori.y, 'z': ori.z, 'w': ori.w},
            'linear_velocity': {'x': lin.x, 'y': lin.y, 'z': lin.z},
            'angular_velocity': {'x': ang.x, 'y': ang.y, 'z': ang.z},
        })

    def path_callback(self, msg: Path):
        poses = []
        for pose_stamped in msg.poses:
            p = pose_stamped.pose.position
            o = pose_stamped.pose.orientation
            poses.append({
                'position': {'x': p.x, 'y': p.y, 'z': p.z},
                'orientation': {'x': o.x, 'y': o.y, 'z': o.z, 'w': o.w},
            })
        self._enqueue('/path', {
            'frame_id': msg.header.frame_id,
            'poses': poses,
        })

    def scan_callback(self, msg: LaserScan):
        self._enqueue('/scan', {
            'angle_min': msg.angle_min,
            'angle_max': msg.angle_max,
            'angle_increment': msg.angle_increment,
            'range_min': msg.range_min,
            'range_max': msg.range_max,
            'ranges': list(msg.ranges),
            'intensities': list(msg.intensities),
        })

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
            pos = data['position']
            ori = data.get('orientation', {'x': 0.0, 'y': 0.0, 'z': 0.0, 'w': 1.0})

            msg = PoseStamped()
            msg.header.stamp = self.get_clock().now().to_msg()
            msg.header.frame_id = 'odom'
            msg.pose.position.x = float(pos['x'])
            msg.pose.position.y = float(pos['y'])
            msg.pose.position.z = float(pos.get('z', 0.0))
            msg.pose.orientation.x = float(ori.get('x', 0.0))
            msg.pose.orientation.y = float(ori.get('y', 0.0))
            msg.pose.orientation.z = float(ori.get('z', 0.0))
            msg.pose.orientation.w = float(ori.get('w', 1.0))

            self._goal_pose_pub.publish(msg)
            self.get_logger().info(f'Published goal pose to {GOAL_POSE_TOPIC}')
        except (KeyError, TypeError, ValueError) as exc:
            self.get_logger().error(f'Malformed goal_pose payload: {exc}')


def main(args=None):
    rclpy.init(args=args)
    node = WsBridgeNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
