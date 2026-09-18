#!/bin/bash
# Instrument manual de diagnostic, SEPARAT de teleoperarea din browser.
# Nu-l rula în paralel cu pagina dashboardului: backendul își pornește
# propriul teleop_twist_keyboard (într-un pseudo-terminal) când apeși
# „Activează teleop" în pagină, iar acela e fluxul normal — nu ai nevoie
# de acest script pentru operare curentă. Dacă rulează deja, „Activează
# teleop" din browser va fi refuzat explicit (publisher extern deja
# prezent pe /cmd_vel_teleop) — oprește acest script (Ctrl+C) înainte.
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
echo "G1 teleop_twist_keyboard -> /cmd_vel_teleop (diagnostic manual)"
echo "  i înainte | , înapoi | j/l rotație | u/o/m/. diagonal"
echo "  k sau orice altă tastă = STOP | Ctrl+C = ieșire"
echo "  Limite inițiale: 0.20 m/s liniar, 0.30 rad/s unghiular"
echo "ATENȚIE: pentru operare normală NU rula acest script — foloseste"
echo "  direct pagina dashboardului: RUN, apoi «Activează teleop», apoi"
echo "  tastează cu pagina focalizată. Dacă acest script rulează deja,"
echo "  «Activează teleop» din browser va fi RESPINS (publisher extern"
echo "  deja pe /cmd_vel_teleop) — oprește-l (Ctrl+C) înainte."
echo "========================================================================="

cd "$SCRIPT_DIR"
exec ros2 run teleop_twist_keyboard teleop_twist_keyboard --ros-args \
    --remap cmd_vel:=/cmd_vel_teleop \
    -p speed:=0.20 \
    -p turn:=0.30
