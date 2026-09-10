#!/bin/bash
# G1 Dashboard A* v5 - un singur stack DDS: ROS 2 Humble + CycloneDDS.

# Scripturile setup ROS/ament citesc intenționat variabile opționale care pot
# fi nedefinite, deci nounset (`set -u`) nu este compatibil cu sursarea lor.
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
DASHBOARD_PYTHON="${G1_DASHBOARD_PYTHON:-python3}"
DASHBOARD_PORT="${G1_DASHBOARD_PORT:-3003}"
if ! [[ "$DASHBOARD_PORT" =~ ^[0-9]+$ ]] || [ "$DASHBOARD_PORT" -lt 1024 ] || [ "$DASHBOARD_PORT" -gt 65535 ]; then
    echo "[EROARE] G1_DASHBOARD_PORT trebuie să fie un port între 1024 și 65535."
    exit 1
fi
LOCK_FILE="/tmp/g1_dashboard_astar_v5_${DASHBOARD_PORT}.lock"
PID_FILE="/tmp/g1_dashboard_astar_v5_${DASHBOARD_PORT}.pid"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    RUNNING_PID="necunoscut"
    if [ -r "$PID_FILE" ]; then
        read -r RUNNING_PID < "$PID_FILE" || RUNNING_PID="necunoscut"
    fi
    echo "[EROARE] dashboard_g1_a*_v5 rulează deja (PID launcher: $RUNNING_PID)."
    exit 1
fi

if ! command -v setsid >/dev/null 2>&1; then
    echo "[EROARE] Comanda setsid lipsește; nu pot garanta oprirea proceselor copil."
    exit 1
fi

SERVER_PID=""
CLEANUP_STARTED=0

stop_managed_process() {
    local child_pid="$1"
    local signal_name="$2"
    local child_pgid=""
    [ -n "$child_pid" ] || return 0
    kill -0 "$child_pid" 2>/dev/null || return 0
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
    echo "Oprire completă dashboard v5..."

    for child_pid in "$SERVER_PID"; do
        stop_managed_process "$child_pid" TERM
    done

    for _attempt in {1..30}; do
        any_running=0
        for child_pid in "$SERVER_PID"; do
            if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
                any_running=1
            fi
        done
        [ "$any_running" -eq 1 ] || break
        sleep 0.2
    done

    for child_pid in "$SERVER_PID"; do
        if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
            stop_managed_process "$child_pid" KILL
        fi
        if [ -n "$child_pid" ]; then
            wait "$child_pid" 2>/dev/null || true
        fi
    done

    if [ -r "$PID_FILE" ]; then
        pid_file_owner=""
        read -r pid_file_owner < "$PID_FILE" || true
        if [ "$pid_file_owner" = "$$" ]; then
            rm -f "$PID_FILE"
        fi
    fi
    echo "Toate procesele pornite de dashboard au fost oprite."
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
printf '%s\n' "$$" > "$PID_FILE"

if [ -f /opt/ros/humble/setup.bash ]; then
    echo "Sursare ROS 2 Humble..."
    source /opt/ros/humble/setup.bash
else
    echo "[EROARE] /opt/ros/humble/setup.bash lipsește."
    exit 1
fi

UNITREE_WS="/home/unitree/unitree_ros2/cyclonedds_ws"
if [ ! -f "$UNITREE_WS/install/setup.bash" ]; then
    echo "[EROARE] Workspace-ul Unitree lipsește: $UNITREE_WS"
    exit 1
fi
echo "Sursare interfețe Unitree: $UNITREE_WS"
source "$UNITREE_WS/install/setup.bash"

# Setări intenționat fixe. v5 nu acceptă FastDDS și nu importă unitree_sdk2py.
export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
# Respectă aceeași configurație ca terminalul în care funcționează ros2 echo.
# O configurație dedicată poate fi selectată explicit, fără a schimba XML-ul global.
if [ -n "${G1_CYCLONEDDS_URI:-}" ]; then
    export CYCLONEDDS_URI="$G1_CYCLONEDDS_URI"
fi
export ROS_LOCALHOST_ONLY=0
export LD_LIBRARY_PATH="/opt/ros/humble/lib/aarch64-linux-gnu:/opt/ros/humble/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

# Împiedică o importare accidentală a SDK-ului din cod adăugat ulterior.
export G1_SKIP_SDK_INIT=1

if ! "$DASHBOARD_PYTHON" -c "import rclpy, fastapi, uvicorn; from unitree_api.msg import Request, Response" >/dev/null 2>&1; then
    echo "[EROARE] Python nu poate importa rclpy/FastAPI/unitree_api."
    exit 1
fi
# Nu atingem serviciile robotului daca portul este deja ocupat.
if command -v ss >/dev/null 2>&1 && ss -H -ltn "sport = :$DASHBOARD_PORT" 2>/dev/null | grep -q .; then
    echo "[EROARE] Portul $DASHBOARD_PORT este deja ocupat. Alege altul cu G1_DASHBOARD_PORT=3015."
    exit 1
fi

# Token propriu v5. Nu reutilizam G1_DASHBOARD_TOKEN mostenit de la v3/v4/v33,
# fiindca browserul si backendul ar ajunge sa foloseasca valori diferite.
TOKEN_FILE="$SCRIPT_DIR/.dashboard_token_v5"
if [ -n "${G1_V5_DASHBOARD_TOKEN:-}" ]; then
    G1_DASHBOARD_TOKEN="$G1_V5_DASHBOARD_TOKEN"
elif [ -r "$TOKEN_FILE" ]; then
    G1_DASHBOARD_TOKEN="$(head -n 1 "$TOKEN_FILE")"
else
    G1_DASHBOARD_TOKEN="$("$DASHBOARD_PYTHON" -c 'import secrets; print(secrets.token_urlsafe(24))')"
    (umask 077; printf '%s\n' "$G1_DASHBOARD_TOKEN" > "$TOKEN_FILE")
fi
export G1_DASHBOARD_TOKEN

WIFI_IP="$(ip -4 -o addr show 2>/dev/null | awk '$4 ~ /^192\.168\.0\./ {split($4,a,"/"); print a[1]; exit}' || true)"
INTERNAL_IP="$(ip -4 -o addr show 2>/dev/null | awk '$4 ~ /^192\.168\.123\./ {split($4,a,"/"); print a[1]; exit}' || true)"

echo "========================================================================="
echo "G1 Dashboard A* v5"
echo "  ROS:        Humble"
echo "  DDS:        CycloneDDS exclusiv"
echo "  SDK Unitree: neutilizat"
echo "  Mapping:    Mid360 3D + odom_pelvis -> hartă 3D + proiecție XY"
echo "  Funcții:    SLAM + localizare + navigație"
echo ""
echo "Dashboard: http://${WIFI_IP:-0.0.0.0}:$DASHBOARD_PORT/?token=$G1_DASHBOARD_TOKEN"
if [ -n "$INTERNAL_IP" ]; then
    echo "Intern:    http://${INTERNAL_IP}:$DASHBOARD_PORT/?token=$G1_DASHBOARD_TOKEN"
fi
echo "API docs:  http://${WIFI_IP:-0.0.0.0}:$DASHBOARD_PORT/docs"
echo "Hărți:     $SCRIPT_DIR/maps"
echo "Oprire:    Ctrl+C"
echo "========================================================================="

export PYTHONPATH="$BACKEND_DIR${PYTHONPATH:+:$PYTHONPATH}"
cd /home/unitree
# Verificare finala inainte de bind.
if command -v ss >/dev/null 2>&1 && ss -H -ltn "sport = :$DASHBOARD_PORT" 2>/dev/null | grep -q .; then
    echo "[EROARE] Portul $DASHBOARD_PORT a fost ocupat între timp de alt dashboard."
    exit 1
fi
setsid "$DASHBOARD_PYTHON" -m uvicorn server:app --host 0.0.0.0 \
    --port "$DASHBOARD_PORT" --ws wsproto --no-access-log 8>&- 9>&- &
SERVER_PID=$!
wait "$SERVER_PID"
