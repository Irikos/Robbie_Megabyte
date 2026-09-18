#!/usr/bin/env python3

import math
import time
import rclpy
from geometry_msgs.msg import Twist
from rclpy.node import Node
import serial


class Bridge(Node):
    def __init__(self):
        super().__init__("bridge")

        self.declare_parameter("serial_port", "/dev/ttyACM0")
        self.declare_parameter("baudrate", 115200)
        self.declare_parameter("steering_range_deg", 60.0)
        self.declare_parameter("motor_range", 50)

        port = self.get_parameter("serial_port").value
        baudrate = self.get_parameter("baudrate").value
        self.steering_range = float(self.get_parameter("steering_range_deg").value)
        self.motor_range = int(self.get_parameter("motor_range").value)
        self.speed = 0.0

        try:
            self.serial_port = serial.Serial(port, baudrate, timeout=0.1)
            self.get_logger().info(f"Connected to serial port {port} at {baudrate} baud")
        except serial.SerialException as exc:
            self.get_logger().error(f"Could not open serial port {port}: {exc}")
            raise

        self.subscriber = self.create_subscription(Twist, "cmd_vel", self.cmd_vel_cb, 10)

    def map_range(self, value, in_min, in_max, out_min, out_max):
        if in_max == in_min:
            return out_min
        mapped = (value - in_min) * (out_max - out_min) / (in_max - in_min) + out_min
        return max(out_min, min(out_max, mapped))

    def cmd_vel_cb(self, msg: Twist):
        # Use angular.z for steering, linear.x for motor command.
        L = 0.165  # wheelbase in meters
        
        # Calculate steering angle using bicycle model
        if msg.linear.x != 0:
            angle = math.degrees(math.atan(L * msg.angular.z / msg.linear.x))
            steering = self.map_range(angle, -22.0, 22.0, -30, 30)
        else:
            steering = self.map_range(msg.angular.z, -1.625, 1.625, -30, 30)

        if msg.linear.x < 0.36 and msg.linear.x > -0.36:
            motor = 0
        elif msg.linear.x >= 0.36:
            motor = self.map_range(msg.linear.x, 0.36, 1.0, 25.0, float(self.motor_range))
        else:
            motor = self.map_range(msg.linear.x, -1.0, -0.36, -float(self.motor_range), -25.0)

        steering_cmd = 98 - int(round(steering))
        motor_cmd = int(round(motor))

        packet = f"{steering_cmd} {motor_cmd}\n".encode("utf-8")
        try:
            self.serial_port.write(packet)
            self.serial_port.flush()
        except serial.SerialException as exc:
            self.get_logger().warn(f"Failed to write to serial: {exc}")


def main(args=None):
    rclpy.init(args=args)
    node = Bridge()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
