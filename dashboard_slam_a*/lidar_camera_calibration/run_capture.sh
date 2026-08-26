#!/usr/bin/env bash
# ROS 2 setup scripts read optional unset variables while being sourced.
set -eo pipefail

TOOL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${G1_CALIBRATION_DATA_DIR:-$TOOL_DIR/data}"
LIDAR_FRAMES="${G1_CALIBRATION_LIDAR_FRAMES:-5}"

if [ -f /opt/ros/humble/setup.bash ]; then
    source /opt/ros/humble/setup.bash
fi
if [ -f /home/unitree/Livox-SDK2/ws_livox/install/setup.bash ]; then
    source /home/unitree/Livox-SDK2/ws_livox/install/setup.bash
fi

# Match the G1 DDS configuration used by start_dashboard.sh.
export ROS_LOCALHOST_ONLY=0
if [ -r /home/unitree/cyclonedds.xml ]; then
    export CYCLONEDDS_URI=/home/unitree/cyclonedds.xml
fi

set -u

exec python3 "$TOOL_DIR/capture_lidar_camera.py" \
    --output "$DATA_DIR" \
    --lidar-frames "$LIDAR_FRAMES" \
    "$@"

