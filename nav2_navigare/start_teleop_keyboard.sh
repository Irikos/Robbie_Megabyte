#!/bin/bash
# Terminal interactiv separat pentru teleop_twist_keyboard.
# Nu schimbă setări globale și nu pornește dashboardul sau modul robotului.

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f /opt/ros/humble/setup.bash ]; then
    echo "[EROARE] ROS 2 Humble nu este instalat."
    exit 1
fi
source /opt/ros/humble/setup.bash

UNITREE_WS="/home/unitree/unitree_ros2/cyclonedds_ws"
if [ ! -f "$UNITREE_WS/install/setup.bash" ]; then
    echo "[EROARE] Workspace-ul ROS 2 Unitree lipsește din $UNITREE_WS."
    exit 1
fi
source "$UNITREE_WS/install/setup.bash"

export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
if [ -n "${G1_CYCLONEDDS_URI:-}" ]; then
    export CYCLONEDDS_URI="$G1_CYCLONEDDS_URI"
fi
export ROS_LOCALHOST_ONLY=0
export LD_LIBRARY_PATH="/opt/ros/humble/lib/aarch64-linux-gnu:/opt/ros/humble/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

if ! ros2 pkg prefix teleop_twist_keyboard >/dev/null 2>&1; then
    echo "[EROARE] Pachetul ROS 2 teleop_twist_keyboard nu este instalat."
    exit 1
fi

echo "========================================================================="
echo "G1 teleop_twist_keyboard -> /cmd_vel_teleop"
echo "  i înainte | , înapoi | j/l rotație | u/o/m/. diagonal"
echo "  k sau orice altă tastă = STOP | Ctrl+C = ieșire"
echo "  Limite inițiale: 0.20 m/s liniar, 0.30 rad/s unghiular"
echo "IMPORTANT: întâi RUN, apoi «Activează teleop» în dashboard."
echo "========================================================================="

cd "$SCRIPT_DIR"
exec ros2 run teleop_twist_keyboard teleop_twist_keyboard --ros-args \
    --remap cmd_vel:=/cmd_vel_teleop \
    -p speed:=0.20 \
    -p turn:=0.30
