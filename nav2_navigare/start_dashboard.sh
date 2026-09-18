#!/bin/bash
# G1 Dashboard Nav2 v3. Rulează numai procese din acest director.

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
DASHBOARD_PYTHON="${G1_DASHBOARD_PYTHON:-python3}"
DASHBOARD_PORT="${G1_NAV2_V3_PORT:-3019}"
if ! [[ "$DASHBOARD_PORT" =~ ^[0-9]+$ ]] || [ "$DASHBOARD_PORT" -lt 1024 ] || [ "$DASHBOARD_PORT" -gt 65535 ]; then
    echo "[EROARE] G1_NAV2_V3_PORT trebuie să fie între 1024 și 65535."
    exit 1
fi

LOCK_FILE="/tmp/g1_dashboard_nav2_v3_${DASHBOARD_PORT}.lock"
PID_FILE="/tmp/g1_dashboard_nav2_v3_${DASHBOARD_PORT}.pid"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    echo "[EROARE] dashboard_g1_nav2_v3 rulează deja pe portul $DASHBOARD_PORT."
    exit 1
fi

NAV2_PID=""
SERVER_PID=""
CLEANUP_STARTED=0

stop_managed_process() {
    local child_pid="$1"
    local signal_name="$2"
    [ -n "$child_pid" ] || return 0
    kill -0 "$child_pid" 2>/dev/null || return 0
    local child_pgid
    child_pgid="$(ps -o pgid= -p "$child_pid" 2>/dev/null | tr -d ' ')"
    if [ "$child_pgid" = "$child_pid" ]; then
        kill -"$signal_name" -- "-$child_pid" 2>/dev/null || true
    else
        kill -"$signal_name" "$child_pid" 2>/dev/null || true
    fi
}

cleanup() {
    [ "$CLEANUP_STARTED" -eq 0 ] || return 0
    CLEANUP_STARTED=1
    trap - EXIT INT TERM HUP
    echo ""
    echo "Oprire procese dashboard Nav2 v3..."
    stop_managed_process "$SERVER_PID" TERM
    stop_managed_process "$NAV2_PID" TERM
    for _attempt in {1..30}; do
        any_running=0
        for child_pid in "$SERVER_PID" "$NAV2_PID"; do
            if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
                any_running=1
            fi
        done
        [ "$any_running" -eq 1 ] || break
        sleep 0.2
    done
    for child_pid in "$SERVER_PID" "$NAV2_PID"; do
        if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
            stop_managed_process "$child_pid" KILL
        fi
        [ -z "$child_pid" ] || wait "$child_pid" 2>/dev/null || true
    done
    if [ -r "$PID_FILE" ]; then
        read -r pid_file_owner < "$PID_FILE" || pid_file_owner=""
        [ "$pid_file_owner" != "$$" ] || rm -f "$PID_FILE"
    fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
printf '%s\n' "$$" > "$PID_FILE"

if [ ! -f /opt/ros/humble/setup.bash ]; then
    echo "[EROARE] ROS 2 Humble nu este instalat."
    exit 1
fi
source /opt/ros/humble/setup.bash

UNITREE_WS="/home/unitree/unitree_ros2/cyclonedds_ws"
if [ ! -f "$UNITREE_WS/install/setup.bash" ]; then
    echo "[EROARE] Interfețele ROS 2 Unitree lipsesc din $UNITREE_WS."
    exit 1
fi
source "$UNITREE_WS/install/setup.bash"

export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
if [ -n "${G1_CYCLONEDDS_URI:-}" ]; then
    export CYCLONEDDS_URI="$G1_CYCLONEDDS_URI"
fi
export ROS_LOCALHOST_ONLY=0
export LD_LIBRARY_PATH="/opt/ros/humble/lib/aarch64-linux-gnu:/opt/ros/humble/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export G1_SKIP_SDK_INIT=1

if ! "$DASHBOARD_PYTHON" -c "import rclpy, fastapi, uvicorn; from nav2_msgs.action import NavigateToPose; from unitree_api.msg import Request" >/dev/null 2>&1; then
    echo "[EROARE] Lipsesc module ROS 2/Nav2/FastAPI necesare."
    exit 1
fi
for package in nav2_bt_navigator nav2_controller nav2_planner nav2_collision_monitor nav2_velocity_smoother pointcloud_to_laserscan teleop_twist_keyboard; do
    if ! ros2 pkg prefix "$package" >/dev/null 2>&1; then
        echo "[EROARE] Pachet ROS 2 lipsă: $package"
        exit 1
    fi
done
if timeout 3 ros2 action list 2>/dev/null | grep -qx '/navigate_to_pose'; then
    echo "[EROARE] Există deja un stack Nav2 cu /navigate_to_pose. Oprește-l înainte de această versiune."
    exit 1
fi
if command -v ss >/dev/null 2>&1 && ss -H -ltn "sport = :$DASHBOARD_PORT" 2>/dev/null | grep -q .; then
    echo "[EROARE] Portul $DASHBOARD_PORT este deja ocupat."
    exit 1
fi

TOKEN_FILE="$SCRIPT_DIR/.dashboard_token_nav2_v3"
if [ -n "${G1_NAV2_V3_TOKEN:-}" ]; then
    G1_DASHBOARD_TOKEN="$G1_NAV2_V3_TOKEN"
elif [ -r "$TOKEN_FILE" ]; then
    read -r G1_DASHBOARD_TOKEN < "$TOKEN_FILE"
else
    G1_DASHBOARD_TOKEN="$("$DASHBOARD_PYTHON" -c 'import secrets; print(secrets.token_urlsafe(24))')"
    (umask 077; printf '%s\n' "$G1_DASHBOARD_TOKEN" > "$TOKEN_FILE")
fi
export G1_DASHBOARD_TOKEN
export PYTHONPATH="$BACKEND_DIR${PYTHONPATH:+:$PYTHONPATH}"

WIFI_IP="$(ip -4 -o addr show 2>/dev/null | awk '$4 ~ /^192\.168\.0\./ {split($4,a,"/"); print a[1]; exit}' || true)"
echo "========================================================================="
echo "G1 Dashboard Nav2 v3"
echo "  Rută:       ComputePathToPose + NavigateToPose"
echo "  Obstacole:  costmap Nav2 + Collision Monitor"
echo "  Teleop:     tastatură ROS 2 -> adaptor manual -> API Sport 7105"
echo "  Nav2:       controller -> smoother -> Collision Monitor -> adaptor manual -> 7105"
echo "  Viteze:     până la 0.80 m/s liniar și 1.60 rad/s unghiular"
echo "  Interzis:   navigația nativă Unitree 1102/1201/1202"
echo "Dashboard: http://${WIFI_IP:-0.0.0.0}:$DASHBOARD_PORT/?token=$G1_DASHBOARD_TOKEN"
echo "Teleop: butonul din dashboard pornește teleop_twist_keyboard; tastele rămân în browser"
echo "Oprire: Ctrl+C"
echo "========================================================================="

cd "$SCRIPT_DIR"
setsid "$DASHBOARD_PYTHON" "$SCRIPT_DIR/nav2/bringup.launch.py" 8>&- 9>&- &
NAV2_PID=$!
setsid "$DASHBOARD_PYTHON" -m uvicorn server:app --app-dir "$BACKEND_DIR" \
    --host 0.0.0.0 --port "$DASHBOARD_PORT" --ws wsproto --no-access-log 8>&- 9>&- &
SERVER_PID=$!

set +e
wait -n "$NAV2_PID" "$SERVER_PID"
exit_code=$?
set -e
if kill -0 "$NAV2_PID" 2>/dev/null && kill -0 "$SERVER_PID" 2>/dev/null; then
    exit "$exit_code"
fi
echo "[EROARE] Un proces administrat s-a oprit neașteptat."
[ "$exit_code" -ne 0 ] || exit_code=1
exit "$exit_code"
