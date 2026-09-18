#!/usr/bin/env python3
"""Simple ROS2 node: subscribes to /scan_odom (nav_msgs/Odometry)
and republishes the pose as a tf transform between header.frame_id and
the odometry's child_frame_id.
"""
import rclpy
from rclpy.node import Node

from nav_msgs.msg import Odometry
from geometry_msgs.msg import TransformStamped
import tf_transformations
from tf2_ros import TransformBroadcaster


class OdomBroadcaster(Node):
    def __init__(self):
        super().__init__('odom_bc')
        self.br = TransformBroadcaster(self)
        self.sub = self.create_subscription(
            Odometry, '/scan_odom', self.odom_cb, 10)
        self.get_logger().info('odom_bc started, subscribing to /scan_odom')

    def odom_cb(self, msg: Odometry):
        t = TransformStamped()
        # preserve the original header time and frame
        t.header.stamp = msg.header.stamp
        t.header.frame_id = msg.header.frame_id if msg.header.frame_id else 'odom'
        # child frame comes from the Odometry message
        t.child_frame_id = msg.child_frame_id if msg.child_frame_id else 'base_link'

        p = msg.pose.pose.position
        q = msg.pose.pose.orientation

        t.transform.translation.x = p.x
        t.transform.translation.y = p.y
        t.transform.translation.z = p.z

        t.transform.rotation.x = q.x
        t.transform.rotation.y = q.y
        t.transform.rotation.z = q.z
        t.transform.rotation.w = q.w

        # broadcast
        self.br.sendTransform(t)


def main(args=None):
    rclpy.init(args=args)
    node = OdomBroadcaster()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()
