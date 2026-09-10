#!/usr/bin/env python3
"""Bridge ROS 2 minimal pentru Mid360 -> pointcloud_to_laserscan.

Primește norul brut cu QoS best-effort, aplică extrinsecul calibrat al G1 și
republică un PointCloud2 XYZ în cadrul ``g1_scan_base``. Nu pornește alt DDS,
nu importă SDK-ul Unitree și nu construiește harta în acest proces.
"""

from __future__ import annotations

import math

import rclpy
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from sensor_msgs.msg import PointCloud2
from sensor_msgs_py import point_cloud2
from std_msgs.msg import Header


INPUT_TOPIC = "/utlidar/cloud_livox_mid360"
OUTPUT_TOPIC = "/cloud_reliable_2d"


def livox_to_base(x: float, y: float, z: float) -> tuple[float, float, float]:
    """Extrinsecul Mid360 -> baza robotului, identic cu cel din dashboard."""
    roll, pitch = 3.14, 0.04014257279586953
    cr, sr = math.cos(roll), math.sin(roll)
    cp, sp = math.cos(pitch), math.sin(pitch)
    x1, y1, z1 = cp * x + sp * z, y, -sp * x + cp * z
    return (
        x1 + 0.0002835,
        cr * y1 - sr * z1 + 0.00003,
        sr * y1 + cr * z1 + 0.40618,
    )


class CloudToScanBridge(Node):
    def __init__(self) -> None:
        super().__init__("g1_cloud_to_scan_bridge")
        sensor_qos = QoSProfile(
            depth=5,
            reliability=ReliabilityPolicy.BEST_EFFORT,
            durability=DurabilityPolicy.VOLATILE,
        )
        output_qos = QoSProfile(
            depth=5,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.VOLATILE,
        )
        self.publisher = self.create_publisher(PointCloud2, OUTPUT_TOPIC, output_qos)
        self.create_subscription(PointCloud2, INPUT_TOPIC, self.on_cloud, sensor_qos)
        self.get_logger().info(f"{INPUT_TOPIC} -> {OUTPUT_TOPIC} [g1_scan_base]")

    def on_cloud(self, message: PointCloud2) -> None:
        converted: list[tuple[float, float, float]] = []
        try:
            for item in point_cloud2.read_points(
                message, field_names=("x", "y", "z"), skip_nans=True
            ):
                x, y, z = (float(value) for value in item)
                if all(math.isfinite(value) for value in (x, y, z)):
                    converted.append(livox_to_base(x, y, z))
        except Exception as exc:
            self.get_logger().warning(f"PointCloud2 invalid: {exc}")
            return
        if not converted:
            return
        header = Header()
        header.stamp = message.header.stamp
        header.frame_id = "g1_scan_base"
        self.publisher.publish(point_cloud2.create_cloud_xyz32(header, converted))


def main() -> None:
    rclpy.init()
    node = CloudToScanBridge()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
