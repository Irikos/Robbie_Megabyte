#!/usr/bin/env python3
"""Bringup Nav2 local; nu modifică niciun fișier sau serviciu global."""

import os
import math
from pathlib import Path
import yaml

from launch import LaunchDescription, LaunchService
from launch.actions import TimerAction, RegisterEventHandler, Shutdown
from launch.event_handlers import OnProcessExit
from launch_ros.actions import Node


def validate_controller_config(params):
    """Refuză configurațiile care declanșează rotația finală prematur în Humble."""
    config = yaml.safe_load(Path(params).read_text(encoding="utf-8"))
    controller = config["controller_server"]["ros__parameters"]
    for name in controller["controller_plugins"]:
        follow = controller[name]
        if "RegulatedPurePursuitController" not in follow["plugin"]:
            continue
        if not follow.get("use_rotate_to_heading", True):
            continue
        lookaheads = [float(follow["lookahead_dist"])]
        if follow.get("use_velocity_scaled_lookahead_dist", False):
            lookaheads += [float(follow["min_lookahead_dist"]),
                          float(follow["max_lookahead_dist"])]
        for checker in controller["goal_checker_plugins"]:
            tolerance = float(controller[checker]["xy_goal_tolerance"])
            if not math.isfinite(tolerance) or tolerance <= 0 or any(
                not math.isfinite(value) or value <= tolerance for value in lookaheads
            ):
                raise ValueError(
                    "Nav2 Humble RPP: lookahead_dist/min/max trebuie să fie "
                    "strict mai mari decât xy_goal_tolerance; altfel robotul "
                    "execută rotația finală înainte de destinație"
                )


def generate_launch_description():
    params = str(Path(__file__).with_name("nav2.yaml"))
    validate_controller_config(params)
    behavior_tree = str(Path(__file__).with_name("navigate_replanning.xml"))
    cloud_topic = os.environ.get("G1_NAV2_CLOUD_TOPIC", "/utlidar/cloud_livox_mid360")
    common = {"parameters": [params], "output": "screen", "emulate_tty": True}
    managed = [
        "controller_server",
        "planner_server",
        "behavior_server",
        "bt_navigator",
        "velocity_smoother",
        "collision_monitor",
    ]
    navigation_nodes = [
        Node(
            package="pointcloud_to_laserscan",
            executable="pointcloud_to_laserscan_node",
            name="pointcloud_to_laserscan",
            remappings=[("cloud_in", cloud_topic), ("scan", "/scan_raw")],
            **common,
        ),
        Node(
            package="nav2_controller",
            executable="controller_server",
            name="controller_server",
            remappings=[("cmd_vel", "/nav2/cmd_vel_nav2")],
            **common,
        ),
        Node(package="nav2_planner", executable="planner_server", name="planner_server", **common),
        Node(
            package="nav2_behaviors",
            executable="behavior_server",
            name="behavior_server",
            remappings=[("cmd_vel", "/nav2/cmd_vel_nav2")],
            **common,
        ),
        Node(
            package="nav2_bt_navigator",
            executable="bt_navigator",
            name="bt_navigator",
            parameters=[params, {"default_nav_to_pose_bt_xml": behavior_tree}],
            output="screen",
            emulate_tty=True,
        ),
        Node(
            package="nav2_velocity_smoother",
            executable="velocity_smoother",
            name="velocity_smoother",
            remappings=[
                ("cmd_vel", "/nav2/cmd_vel_raw"),
                ("cmd_vel_smoothed", "/nav2/cmd_vel_smoothed"),
            ],
            **common,
        ),
        Node(package="nav2_collision_monitor", executable="collision_monitor", name="collision_monitor", **common),
        TimerAction(
            period=3.0,
            actions=[
                Node(
                    package="nav2_lifecycle_manager",
                    executable="lifecycle_manager",
                    name="lifecycle_manager_navigation",
                    output="screen",
                    parameters=[{"use_sim_time": False, "autostart": True, "node_names": managed}],
                )
            ],
        ),
    ]
    return LaunchDescription([
        RegisterEventHandler(OnProcessExit(on_exit=[Shutdown(reason="Un nod Nav2 s-a oprit")])),
        *navigation_nodes,
    ])


if __name__ == "__main__":
    service = LaunchService()
    service.include_launch_description(generate_launch_description())
    raise SystemExit(service.run())
