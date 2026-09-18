#!/usr/bin/env bash
# ==============================================================================
# start_car_common.sh - Starts Base Hardware & Bridge Services on the RC Car
# Run inside the car's Docker container: bash start_car_common.sh
# Mode switching (Mapping / Localization) is controlled dynamically via Dashboard
# ==============================================================================
set -eo pipefail

params_file=/root/humble_ws/src/lab1/params/nav2_car_params.yaml
workspace=/root/humble_ws

usage() {
    printf '%s\n' \
        'Usage: bash start_car_common.sh [--params-file PATH]' \
        'Starts common base services (LiDAR, motor controller, ws_bridge_v2, bridge).' \
        'Mapping and Localization are switched on-demand from the Dashboard.'
}

while (($#)); do
    case "$1" in
        --params-file)
            if (($# < 2)) || [[ -z "$2" ]]; then
                printf 'Missing value for %s\n' "$1" >&2
                exit 2
            fi
            params_file=$2
            shift 2
            ;;
        -h|--help) usage; exit 0 ;;
        *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
    esac
done

for required in /opt/ros/humble/setup.bash "$workspace/install/setup.bash" "$params_file"; do
    if [[ ! -r "$required" ]]; then
        printf 'Required file is missing or unreadable: %s\n' "$required" >&2
        exit 1
    fi
done

source /opt/ros/humble/setup.bash
source "$workspace/install/setup.bash"
command -v setsid >/dev/null || { printf 'Missing setsid (install util-linux in the container).\n' >&2; exit 1; }
ros2 pkg prefix lab1 >/dev/null

export CAR_DASHBOARD_WS_URL="${CAR_DASHBOARD_WS_URL:-ws://192.168.0.116:3003/ws/car}"
export CAR_PATH_TOPICS="${CAR_PATH_TOPICS:-/plan,/received_global_plan,/path}"

pids=()
cleanup() {
    local result=$?
    trap - EXIT
    trap '' INT TERM
    if ((${#pids[@]})); then
        printf '\nStopping common car services...\n'
        for pid in "${pids[@]}"; do kill -INT -- "-$pid" 2>/dev/null || true; done
        for attempt in {1..30}; do
            local alive=0
            for pid in "${pids[@]}"; do
                if kill -0 -- "-$pid" 2>/dev/null; then alive=1; fi
            done
            ((alive)) || break
            sleep 0.1
        done
        for pid in "${pids[@]}"; do kill -TERM -- "-$pid" 2>/dev/null || true; done
        sleep 0.5
        for pid in "${pids[@]}"; do kill -KILL -- "-$pid" 2>/dev/null || true; done
        for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
    fi
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

start_service() {
    printf 'Starting:'
    printf ' %q' "$@"
    printf '\n'
    setsid "$@" &
    pids+=("$!")
}

# Start the 3 common base services
start_service ros2 launch lab1 car_launch.py "params_file:=$params_file" use_sim_time:=False
start_service ros2 run lab1 ws_bridge_v2
start_service ros2 run lab1 bridge

printf '\nCommon car services started (LiDAR + Odometry + Bridges).\n'
printf 'Ready for Mapping / Localization control from Dashboard. Ctrl+C stops all.\n'

result=0
wait -n "${pids[@]}" || result=$?
printf '\nA car service exited (status %s); stopping remaining services.\n' "$result" >&2
if ((result == 0)); then result=1; fi
exit "$result"
