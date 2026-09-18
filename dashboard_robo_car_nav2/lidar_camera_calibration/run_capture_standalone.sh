#!/usr/bin/env bash
set -eo pipefail

TOOL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${G1_CALIBRATION_DATA_DIR:-$TOOL_DIR/data}"
LIDAR_FRAMES="${G1_CALIBRATION_LIDAR_FRAMES:-5}"
LIDAR_TOPIC="/utlidar/cloud_livox_mid360"
LIDAR_CONFIG="/home/unitree/g1_ws/assets/mid360.robot.json"
LIDAR_PID=""

source /opt/ros/humble/setup.bash
if [ -f /home/unitree/Livox-SDK2/ws_livox/install/setup.bash ]; then
    source /home/unitree/Livox-SDK2/ws_livox/install/setup.bash
fi
export ROS_LOCALHOST_ONLY=0
if [ -r /home/unitree/cyclonedds.xml ]; then
    export CYCLONEDDS_URI=/home/unitree/cyclonedds.xml
fi
set -u

cleanup() {
    if [ -n "$LIDAR_PID" ]; then
        kill "$LIDAR_PID" 2>/dev/null || true
        wait "$LIDAR_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

lidar_has_frame() {
    timeout "${1:-6}" ros2 topic echo \
        "$LIDAR_TOPIC" sensor_msgs/msg/PointCloud2 \
        --once --field header --qos-reliability best_effort \
        >/dev/null 2>&1
}

if lidar_has_frame 6; then
    echo "LiDAR stream: existing publisher is delivering PointCloud2"
elif ros2 pkg prefix livox_ros_driver2 >/dev/null 2>&1 && [ -r "$LIDAR_CONFIG" ]; then
    echo "LiDAR stream absent; starting standalone Mid-360 driver..."
    ros2 run livox_ros_driver2 livox_ros_driver2_node --ros-args \
        -r __node:=g1_calibration_livox \
        -r /livox/lidar:="$LIDAR_TOPIC" \
        -p xfer_format:=0 -p multi_topic:=0 -p data_src:=0 \
        -p publish_freq:=10.0 -p output_data_type:=0 \
        -p frame_id:=livox_frame -p user_config_path:="$LIDAR_CONFIG" &
    LIDAR_PID=$!
    if ! lidar_has_frame 12; then
        echo "ERROR: Mid-360 driver started but delivered no PointCloud2." >&2
        exit 1
    fi
    echo "LiDAR stream: standalone driver is delivering PointCloud2"
else
    echo "ERROR: no LiDAR frames and driver/configuration are unavailable." >&2
    exit 1
fi

python3 "$TOOL_DIR/capture_lidar_camera.py" \
    --output "$DATA_DIR" \
    --lidar-frames "$LIDAR_FRAMES" \
    --web-preview \
    "$@"
