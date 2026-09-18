#!/usr/bin/env bash

TARGET="$HOME/bacalbasa_dashboard_parallel_test_v1"
RUN="$TARGET/run"

G1XR_PY="$HOME/miniconda3/envs/g1_xr/bin/python"
SENDER="$HOME/g1_quest_fullbody_sender.py"

SLAM_STATE="/tmp/g1_dashboard_slam_$(id -u)"
SLAM_MAP="$HOME/g1_ws/map/harta_buna_2707.pcd"

mkdir -p "$RUN"

echo
echo "============================================================"
echo " BACALBASA PARALLEL DASHBOARD — READ-ONLY START"
echo "============================================================"


echo
echo "----- SAFETY GUARDS -----"

SAFE=1

if grep -q \
    'BACALBASA PARALLEL READ-ONLY GUARD' \
    "$TARGET/g1_dashboard_process_manager.py"
then
    echo "PASS: controller autostart guard"
else
    echo "FAIL: controller autostart guard missing"
    SAFE=0
fi

if grep -q \
    'BACALBASA_PARALLEL_SLAM_READ_ONLY_GUARD' \
    "$TARGET/g1_dashboard_slam_worker.py"
then
    echo "PASS: SLAM Initial Pose guard"
else
    echo "FAIL: SLAM read-only guard missing"
    SAFE=0
fi


if [ "$SAFE" = "1" ]; then

    echo
    echo "----- SYSTEM MONITOR -----"

    OLD="$(cat "$RUN/monitor.pid" 2>/dev/null || true)"

    if [ -n "$OLD" ] && kill -0 "$OLD" 2>/dev/null; then
        echo "already running PID $OLD"
    else
        nohup "$G1XR_PY" \
            "$TARGET/g1_dashboard_system_monitor.py" \
            --network-interface=enP8p1s0 \
            --unitree-services=on \
            --base-sensing=on \
            --udp-host=127.0.0.1 \
            --udp-port=8766 \
            --hz=4 \
            >"$RUN/monitor.log" 2>&1 &

        echo "$!" > "$RUN/monitor.pid"
        echo "started PID $!"
    fi


    echo
    echo "----- DASHBOARD BRIDGE -----"

    OLD="$(cat "$RUN/bridge.pid" 2>/dev/null || true)"

    if [ -n "$OLD" ] && kill -0 "$OLD" 2>/dev/null; then
        echo "already running PID $OLD"

    elif ss -lntp "sport = :8082" 2>/dev/null | grep -q LISTEN; then
        echo "WARNING: port 8082 already has a listener"
        ss -lntp "sport = :8082" 2>/dev/null || true

    else
        # FULL_DASH_ACTION_CAPABLE_START_V20_7
        ACTION_TOKEN_FILE="$RUN/action_token"

        if [ ! -s "$ACTION_TOKEN_FILE" ]; then
            umask 077
            /usr/bin/python3 -c \
              'import secrets; print(secrets.token_urlsafe(32))' \
              > "$ACTION_TOKEN_FILE"
            chmod 600 "$ACTION_TOKEN_FILE"
        fi

        ACTION_TOKEN="$(
            tr -d '\r\n' < "$ACTION_TOKEN_FILE"
        )"

        if [ "${#ACTION_TOKEN}" -lt 16 ]; then
            echo "ERROR: invalid Full Dash action token"
            exit 1
        fi

        nohup env \
            G1_DASHBOARD_ACTION_TOKEN="$ACTION_TOKEN" \
            G1_QUEST_TELEMETRY_IP="192.168.0.183" \
            G1_QUEST_TELEMETRY_PORT="5055" \
            G1_QUEST_TELEMETRY_INTERFACE="enP8p1s0" \
            G1_QUEST_TELEMETRY_HZ="30" \
            G1_DASHBOARD_WEB_DERIVED_FPS="30" \
            G1_UNITY_TELEVUER_MOTION_ENABLED="1" \
            G1_UNITY_TELEVUER_STABLE_FRAMES="4" \
            G1_UNITY_TELEVUER_STALE_TIMEOUT_S="0.50" \
            FULL_DASH_DRAGOS_QUEST_PARITY_V21_2="1" \
            G1_DASHBOARD_CONTROLLER_STATE="$RUN/controller.json" \
            G1_DASHBOARD_CONTROLLER_LOG="$RUN/controller.log" \
            G1_DASHBOARD_CAMERA_STATE="$RUN/camera.json" \
            G1_DASHBOARD_FULLBODY_STATE="$RUN/fullbody.json" \
            G1_DASHBOARD_INSPIRE_HELPER="/usr/local/libexec/g1-dashboard/g1_dashboard_inspire_helper.py" \
            G1_DASHBOARD_CONTROLLER_SCRIPT="$HOME/xr_teleoperate_g1demo/teleop/g1_locomotion_xr_handover_live_v6_7_4_symmetric_thumb_control_dashboard_telemetry_v1_8.py" \
            G1_DASHBOARD_CONTROLLER_PYTHON="$HOME/miniconda3/envs/g1_xr/bin/python" \
            G1_DASHBOARD_SLAM_STATE_DIR="$SLAM_STATE" \
            G1_DASHBOARD_SLAM_MAP="$SLAM_MAP" \
            /usr/bin/python3 \
            "$TARGET/g1_dashboard_bridge.py" \
            --udp-host=127.0.0.1 \
            --udp-port=8765 \
            --system-udp-port=8766 \
            --robot-udp-port=8768 \
            --http-host=0.0.0.0 \
            --http-port=8082 \
            --enable-process-actions \
            >"$RUN/bridge.log" 2>&1 &

        echo "$!" > "$RUN/bridge.pid"
        echo "started PID $!"
    fi


    echo
    echo "----- PASSIVE LOWSTATE STREAM -----"
    echo "FULL_DASH_PROCESS_MANAGER_OWNED_SENDER_V20_7"
    echo "sender lifecycle is owned by Full Dash persistent browser stream"

    echo "----- READ-ONLY SLAM -----"

    OLD="$(cat "$RUN/slam.pid" 2>/dev/null || true)"

    if [ -n "$OLD" ] && kill -0 "$OLD" 2>/dev/null; then
        echo "already running PID $OLD"

    elif pgrep -f \
        "$TARGET/g1_dashboard_slam_worker.py" \
        >/dev/null 2>&1
    then
        echo "SLAM observer already running"

    else
        nohup "$RUN/start_slam_readonly.sh" \
            >"$RUN/slam.log" 2>&1 &

        echo "$!" > "$RUN/slam.pid"
        echo "started PID $!"
    fi


    echo
    echo "----- WAIT FOR DATA -----"
    sleep 5


    echo
    echo "----- STATUS -----"

    for NAME in monitor bridge robot_sender slam
    do
        PID="$(cat "$RUN/$NAME.pid" 2>/dev/null || true)"

        printf "%-14s " "$NAME"

        if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
            echo "RUNNING PID $PID"
        else
            echo "NOT RUNNING"
        fi
    done


    echo
    echo "----- API QUICK CHECK -----"

    /usr/bin/python3 - <<'PY'
import json
from urllib.request import urlopen

BASE = "http://127.0.0.1:8082"

def get(path):
    with urlopen(BASE + path, timeout=5) as r:
        return json.loads(r.read())

try:
    latest = get("/api/latest")
    bridge = latest.get("bridge", {})

    print(
        "robot_online:",
        bridge.get("robot_online")
    )
    print(
        "robot_packets:",
        bridge.get("robot_packet_count")
    )
    print(
        "robot_invalid:",
        bridge.get("robot_invalid_count")
    )

    system = get("/api/system")
    s = system.get("system", {})

    print(
        "system_monitor:",
        system.get("monitor", {}).get("online")
    )
    print(
        "services:",
        s.get("robot_state_api", {}).get("available")
    )
    print(
        "imu:",
        s.get("base_sensing", {})
         .get("imu", {})
         .get("available")
    )
    print(
        "odometry:",
        s.get("base_sensing", {})
         .get("odometry", {})
         .get("available")
    )

    slam = get("/api/slam/status")

    print(
        "slam_worker:",
        slam.get("worker_online")
    )
    print(
        "slam_state:",
        slam.get("state")
    )
    print(
        "slam_cloud:",
        (slam.get("cloud") or {}).get("online")
    )

except Exception as exc:
    print("API ERROR:", repr(exc))
PY


    echo
    echo "============================================================"
    echo " DASHBOARD:"
    echo " http://192.168.0.116:8082/"
    echo "============================================================"

else

    echo
    echo "NOT STARTED."
    echo "One of the read-only safety guards is missing."

fi
