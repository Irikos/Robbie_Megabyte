#!/bin/bash
# =====================================================================
# start_dashboard.sh - Pornire G1 Dashboard pe Orin
# =====================================================================
# Rulare: bash start_dashboard.sh
# Acces: http://<IP_ORIN>:3003 (ex: http://192.168.0.116:3003)
#
# Bridge-ul /cmd_vel este dezactivat implicit pentru ca dashboardul și
# teleop_twist_keyboard să nu creeze două instanțe SportClient concurente.
# Activează-l explicit cu: bash start_dashboard.sh --teleop-bridge

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"

# Un singur proces poate administra Mid360, camera și API-urile SLAM.
DASHBOARD_LOCK_FILE="$SCRIPT_DIR/.dashboard.lock"
exec 9>"$DASHBOARD_LOCK_FILE"
if ! flock -n 9; then
    echo "[ERROR] Acest dashboard rulează deja (lock: $DASHBOARD_LOCK_FILE)."
    echo "        Oprește instanța existentă cu Ctrl+C, apoi pornește din nou."
    exit 1
fi

ENABLE_TELEOP_BRIDGE=0
ENABLE_NAV2_OBSERVER=0
ENABLE_NATIVE_SLAM_REPAIR=0
for arg in "$@"; do
    if [ "$arg" == "--teleop-bridge" ]; then
        ENABLE_TELEOP_BRIDGE=1
    fi
    if [ "$arg" == "--nav2-observer" ]; then
        ENABLE_NAV2_OBSERVER=1
    fi
    if [ "$arg" == "--repair-native-slam" ]; then
        ENABLE_NATIVE_SLAM_REPAIR=1
    fi
done

if [ "$ENABLE_TELEOP_BRIDGE" == "1" ]; then
    export G1_DASHBOARD_TELEOP_ENABLED=0
else
    export G1_DASHBOARD_TELEOP_ENABLED=1
fi

# =====================================================================
# Sursare mediu ROS 2 și workspace Unitree
# =====================================================================
if [ -f "/opt/ros/humble/setup.bash" ]; then
    echo "Sursare ROS 2 Humble..."
    source /opt/ros/humble/setup.bash
elif [ -f "/opt/ros/jazzy/setup.bash" ]; then
    echo "Sursare ROS 2 Jazzy..."
    source /opt/ros/jazzy/setup.bash
fi

for ws in "$SCRIPT_DIR/../unitree_interfaces_ws" "/home/matei/Desktop/Coduri/unitree_interfaces_ws" "/home/unitree/unitree_ros2/cyclonedds_ws" "/home/unitree/unitree_ros2" "/home/unitree/cyclonedds_ws" "/home/unitree/ros2_ws" "/home/unitree/workspace/unitree_ros2"; do
    if [ -f "$ws/install/setup.bash" ]; then
        echo "Sursare workspace Unitree din: $ws"
        source "$ws/install/setup.bash"
        break
    fi
done

# Driverul Mid360 este construit într-un workspace separat de interfețele
# Unitree. Îl suprapunem ca să putem porni fallback-ul local când robotul nu
# mai publică topicul brut.
LIVOX_WS="/home/unitree/Livox-SDK2/ws_livox"
if [ -f "$LIVOX_WS/install/setup.bash" ]; then
    source "$LIVOX_WS/install/setup.bash"
fi

export ROS_LOCALHOST_ONLY=0
export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
export CYCLONEDDS_URI="$SCRIPT_DIR/config/cyclonedds.xml"
# Se aplică numai copiilor acestei lansări, niciun fișier DDS global nu se schimbă.


echo "======================================"
echo " G1 Robot Dashboard - Pornire"
echo "======================================"

# Nu pornim aparent o versiune nouă peste un uvicorn vechi. În acest caz
# uvicorn ar eșua cu "address already in use", iar browserul ar continua să
# controleze codul vechi de pe portul 3003 fără ca operatorul să observe.
if command -v ss >/dev/null 2>&1 && ss -H -ltn 'sport = :3003' 2>/dev/null | grep -q .; then
    echo "[ERROR] Portul 3003 este deja folosit de un dashboard vechi."
    echo "        Oprește terminalul vechi cu Ctrl+C, apoi rulează din nou această comandă."
    exit 1
fi

# Verifica Python
if ! command -v python3 &>/dev/null; then
    echo "[ERROR] Python3 nu e instalat."
    exit 1
fi

# Profilul A* + 1102 nu depinde de SciPy. ICP este o funcție experimentală
# opțională și nu mai are voie să decidă dacă dashboardul poate porni.
DASHBOARD_PYTHON="${G1_DASHBOARD_PYTHON:-python3}"
if ! "$DASHBOARD_PYTHON" -c "import numpy, cv2" >/dev/null 2>&1; then
    echo "[ERROR] Interpreterul selectat nu are NumPy/OpenCV: $DASHBOARD_PYTHON"
    exit 1
fi

# Token obligatoriu pentru toate endpointurile de control și WebSocket.
# Dacă nu vine din mediu, îl păstrăm local cu permisiuni 0600. Altfel fiecare
# restart invalida sessionStorage-ul browserului și toate controalele păreau
# inactive deși backendul funcționa.
if [ -z "${G1_DASHBOARD_TOKEN:-}" ]; then
    TOKEN_FILE="$SCRIPT_DIR/.dashboard_token"
    if [ -r "$TOKEN_FILE" ]; then
        G1_DASHBOARD_TOKEN=$(head -n 1 "$TOKEN_FILE")
    else
        G1_DASHBOARD_TOKEN=$("$DASHBOARD_PYTHON" -c "import secrets; print(secrets.token_urlsafe(24))")
        (umask 077; printf '%s\n' "$G1_DASHBOARD_TOKEN" > "$TOKEN_FILE")
    fi
    export G1_DASHBOARD_TOKEN
fi

# Instaleaza dependente daca lipsesc
echo "[1/3] Verificare dependente Python..."
cd "$BACKEND_DIR"

# Incearca sa instaleze in mediul curent (g1_deploy sau global)
"$DASHBOARD_PYTHON" -c "import fastapi, wsproto" 2>/dev/null || {
    echo "   Instalez fastapi, uvicorn, wsproto..."
    "$DASHBOARD_PYTHON" -m pip install \
        fastapi "uvicorn[standard]" aiofiles python-multipart wsproto --quiet
}
"$DASHBOARD_PYTHON" -c "import uvicorn" 2>/dev/null \
    || "$DASHBOARD_PYTHON" -m pip install "uvicorn[standard]" --quiet

# Driverul Livox local folosit de versiunile mai noi poate lăsa persistent
# destinațiile Mid360 pe Orin (.164). API 1804 rulează în serviciul Unitree
# (.161), deci restaurăm explicit atât punctele, cât și IMU-ul.
MID360_RESTORE_SOURCE="$BACKEND_DIR/tools/restore_mid360_native.cpp"
MID360_RESTORE_DIR="/tmp/g1_dashboard_v24_mid360"
MID360_RESTORE_BIN="$MID360_RESTORE_DIR/restore_mid360_native"
if [ "$ENABLE_NATIVE_SLAM_REPAIR" == "1" ]; then
    if [ ! -f "$MID360_RESTORE_SOURCE" ]; then
        echo "[ERROR] Lipsește utilitarul Mid360: $MID360_RESTORE_SOURCE"
        exit 1
    fi
    mkdir -p "$MID360_RESTORE_DIR"
    if [ ! -x "$MID360_RESTORE_BIN" ] \
            || [ "$MID360_RESTORE_SOURCE" -nt "$MID360_RESTORE_BIN" ]; then
        if ! command -v g++ >/dev/null 2>&1; then
            echo "[ERROR] g++ lipsește; restaurarea LiDAR/IMU nu poate fi construită."
            exit 1
        fi
        g++ -std=c++11 -pthread -I/home/unitree/Livox-SDK2/include \
            "$MID360_RESTORE_SOURCE" \
            /home/unitree/Livox-SDK2/build/sdk_core/liblivox_lidar_sdk_static.a \
            -o "$MID360_RESTORE_BIN"
    fi
    export G1_MID360_RESTORE_BIN="$MID360_RESTORE_BIN"
fi

echo "[2/3] Dependente OK"

# Gaseste IP-ul WiFi pentru afisare
WIFI_IP=$(ip addr show | grep "192.168.0\." | grep -oP '(?<=inet )\d+\.\d+\.\d+\.\d+' | head -1)
INTERNAL_IP=$(ip addr show | grep "192.168.123\." | grep -oP '(?<=inet )\d+\.\d+\.\d+\.\d+' | head -1)

echo ""
echo "[3/3] Pornire server FastAPI..."
echo ""
echo "  ✓ Dashboard: http://${WIFI_IP:-0.0.0.0}:3003"
echo "  ✓ API docs:  http://${WIFI_IP:-0.0.0.0}:3003/docs"
echo "  ✓ Token:     ${G1_DASHBOARD_TOKEN}"
if [ -n "$INTERNAL_IP" ]; then
echo "  ✓ Intern:    http://${INTERNAL_IP}:3003"
fi
echo ""

BRIDGE_PID=""
CAMERA_PID=""
NAV2_PID=""
BACKEND_PID=""

cleanup() {
    local saved_status=$? pid alive attempt
    trap - EXIT INT TERM
    echo "Oprire procese ale dashboardului..."
    # Toate procesele lansate mai jos au sesiuni proprii (setsid). Oprim și
    # descendenții Nav2, nu numai procesul Python care i-a lansat.
    for pid in "$BACKEND_PID" "$BRIDGE_PID" "$CAMERA_PID" "$NAV2_PID"; do
        [ -z "$pid" ] || kill -TERM -- "-$pid" 2>/dev/null || true
    done
    for attempt in {1..80}; do
        alive=0
        for pid in "$BACKEND_PID" "$BRIDGE_PID" "$CAMERA_PID" "$NAV2_PID"; do
            if [ -n "$pid" ] && kill -0 -- "-$pid" 2>/dev/null; then alive=1; fi
        done
        [ "$alive" = 1 ] || break
        sleep 0.1
    done
    for pid in "$BACKEND_PID" "$BRIDGE_PID" "$CAMERA_PID" "$NAV2_PID"; do
        [ -z "$pid" ] || kill -KILL -- "-$pid" 2>/dev/null || true
        [ -z "$pid" ] || wait "$pid" 2>/dev/null || true
    done
    exit "$saved_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Pornirea stabilă v23 nu modifica serviciile robotului și ajungea direct la
# backend. Reparația Mid360 rămâne o operație explicită de mentenanță;
# nu mai poate opri lansarea dashboardului în utilizarea normală.
if [ "$ENABLE_NATIVE_SLAM_REPAIR" == "1" ]; then
    if pgrep -f '[l]ivox_ros_driver2_node' >/dev/null 2>&1; then
        echo "[ERROR] Un driver Livox generic rulează; reparația nativă nu este sigură."
        exit 1
    fi
    NATIVE_SLAM_HELPER="$BACKEND_DIR/ensure_native_slam_services.py"
    UNITREE_SDK_PYTHONPATH="/home/unitree/unitree_sdk2_python${PYTHONPATH:+:$PYTHONPATH}"
    if ! PYTHONPATH="$UNITREE_SDK_PYTHONPATH" python3 "$NATIVE_SLAM_HELPER" \
            --interface enP8p1s0 --timeout 20 --stop-native-sensors; then
        echo "[ERROR] Serviciile native LiDAR/SLAM nu au confirmat oprirea."
        exit 1
    fi
    if ! LD_LIBRARY_PATH="/home/unitree/Livox-SDK2/build/sdk_core${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
            timeout 40 "$MID360_RESTORE_BIN" \
            /home/unitree/g1_ws/assets/mid360.robot.json 192.168.123.161; then
        echo "[ERROR] Fluxurile Mid360 LiDAR/IMU nu au putut fi restaurate spre Unitree .161."
        exit 1
    fi
    if ! PYTHONPATH="$UNITREE_SDK_PYTHONPATH" python3 "$NATIVE_SLAM_HELPER" \
            --interface enP8p1s0 --timeout 20 --restart-slam; then
        echo "[ERROR] lidar_driver/unitree_slam nu au confirmat restartul."
        exit 1
    fi
    echo "  ✓ Mid360 reparat: LiDAR + IMU rezervate serviciului Unitree"
else
    echo "  ✓ Nav2 prin ROS 2; serviciile native Mid360/SLAM rămân nemodificate"
fi

# Navigarea autonomă este realizată EXCLUSIV de Nav2 (identic cu v3):
# controller_server + planner_server + behavior_server + bt_navigator +
# velocity_smoother + Collision Monitor + pointcloud_to_laserscan (/scan_raw).
# Adaptorul din server ia /nav2/cmd_vel_safe și îl trimite la robot prin Sport
# API 7105. Planificatorul A* și API-urile native 1102/1201/1202 nu mai există.
NAV2_BRINGUP="$SCRIPT_DIR/nav2v3/bringup.launch.py"
unset G1_ENABLE_NAV2_OBSERVER
if command -v ros2 >/dev/null 2>&1 && ros2 pkg prefix nav2_planner >/dev/null 2>&1; then
    if timeout 3 ros2 action list 2>/dev/null | grep -qx '/navigate_to_pose'; then
        echo "[ERROR] Există deja un stack Nav2 cu /navigate_to_pose. Oprește-l înainte de robot+car."
        exit 1
    fi
    for pkg in nav2_controller nav2_planner nav2_behaviors nav2_bt_navigator \
               nav2_velocity_smoother nav2_collision_monitor nav2_lifecycle_manager \
               pointcloud_to_laserscan; do
        if ! ros2 pkg prefix "$pkg" >/dev/null 2>&1; then
            echo "[ERROR] Pachet ROS 2 Nav2 lipsă: $pkg"
            exit 1
        fi
    done
    echo "  ✓ Nav2 complet: bringup.launch.py (controller/planner/smoother/collision + scan)"
    setsid "$DASHBOARD_PYTHON" "$NAV2_BRINGUP" 9>&- &
    NAV2_PID=$!
else
    echo "[ERROR] Nav2 nu este instalat; robot+car nu are altă metodă de navigare."
    echo "        Instalează stack-ul Nav2 (Humble) înainte de a porni dashboardul."
    exit 1
fi

# Camera nu se conectează până când receptorul 5005 și contextul ROS sunt gata.
setsid "$DASHBOARD_PYTHON" -m uvicorn server:app --host 0.0.0.0 --port 3003 \
    --ws wsproto --loop asyncio 9>&- &
BACKEND_PID=$!
BACKEND_READY=0
for attempt in {1..60}; do
    if ! kill -0 "$BACKEND_PID" 2>/dev/null || ! kill -0 "$NAV2_PID" 2>/dev/null; then
        echo "[ERROR] Backendul sau Nav2 s-a oprit în timpul pornirii."
        exit 1
    fi
    if "$DASHBOARD_PYTHON" -c 'import json, os, urllib.request; req=urllib.request.Request("http://127.0.0.1:3003/api/health/startup", headers={"X-G1-Token": os.environ["G1_DASHBOARD_TOKEN"]}); r=urllib.request.urlopen(req, timeout=1); assert json.load(r)["ready"]' >/dev/null 2>&1; then
        BACKEND_READY=1
        break
    fi
    sleep 1
done
if [ "$BACKEND_READY" != 1 ]; then
    echo "[ERROR] Backendul ROS/receptorul camerei nu este gata după 60 de încercări."
    exit 1
fi
echo "  ✓ Backend ROS și receptor RealSense 5005 disponibile"

# Camera RealSense este parte din protecția autonomiei. O pornim automat,
# astfel încât operatorul să folosească o singură comandă. Dacă există deja
# o instanță, nu deschidem încă o dată dispozitivul USB.
CAMERA_SCRIPT="/home/unitree/unitree_sdk2_python/send_video_depth.py"
if [ -f "$CAMERA_SCRIPT" ]; then
    if pgrep -f "python3 $CAMERA_SCRIPT" >/dev/null 2>&1 || pgrep -f "python3 send_video_depth.py" >/dev/null 2>&1; then
        echo "  ✓ Camera RealSense: rulează deja"
    else
        echo "  ✓ Camera RealSense: pornire automată"
        setsid python3 "$CAMERA_SCRIPT" 9>&- &
        CAMERA_PID=$!
    fi
else
    echo "  ! Camera RealSense lipsește: $CAMERA_SCRIPT"
fi

if [ "$ENABLE_TELEOP_BRIDGE" == "1" ] && [ -f "$BACKEND_DIR/cmd_vel_bridge.py" ]; then
    if python3 -c "import rclpy" 2>/dev/null; then
        echo "  ✓ Teleop bridge: activ (/cmd_vel -> robot). Rulează separat:"
        echo "      ros2 run teleop_twist_keyboard teleop_twist_keyboard"
        echo ""
        setsid python3 "$BACKEND_DIR/cmd_vel_bridge.py" 9>&- &
        BRIDGE_PID=$!
    else
        echo "  ! rclpy indisponibil, cmd_vel_bridge NU pornește (doar dashboard)."
        echo ""
    fi
else
    echo "  - Teleop bridge dezactivat (activează cu --teleop-bridge)"
    echo ""
fi

echo "  Apasa Ctrl+C pentru oprire."
echo "======================================"

# Orice copil critic oprit închide întreaga instanță și eliberează participanții.
CHILD_PIDS=("$BACKEND_PID" "$NAV2_PID")
[ -z "$CAMERA_PID" ] || CHILD_PIDS+=("$CAMERA_PID")
[ -z "$BRIDGE_PID" ] || CHILD_PIDS+=("$BRIDGE_PID")
wait -n "${CHILD_PIDS[@]}"
echo "[ERROR] Un proces al dashboardului s-a oprit; închid instanța."
exit 1
