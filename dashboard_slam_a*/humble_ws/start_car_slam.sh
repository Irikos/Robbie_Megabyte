#!/usr/bin/env bash
# Run inside the car's Docker container: bash start_car_slam.sh [--slam-params PATH]
set -eo pipefail

slam_params_file=/root/humble_ws/custom_params.yaml
params_file=/root/humble_ws/src/lab1/params/nav2_car_params.yaml
workspace=/root/humble_ws

usage() {
    printf '%s\n' \
        'Usage: bash start_car_slam.sh [--slam-params PATH] [--params-file PATH]' \
        'Run inside the car Docker container, with paths inside that container.' \
        'Default slam_params: /root/humble_ws/custom_params.yaml' \
        'Optional environment: CAR_DASHBOARD_WS_URL, CAR_PATH_TOPICS'
}

while (($#)); do
    case "$1" in
        --slam-params)
            if (($# < 2)) || [[ -z "$2" ]]; then
                printf 'Missing value for %s\n' "$1" >&2
                exit 2
            fi
            slam_params_file=$2
            shift 2
            ;;
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

for required in /opt/ros/humble/setup.bash "$workspace/install/setup.bash" "$slam_params_file" "$params_file"; do
    if [[ ! -r "$required" ]]; then
        printf 'Required file is missing or unreadable: %s\n' "$required" >&2
        exit 1
    fi
done

# ROS setup scripts may access unset variables, so do not use nounset here.
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
        printf '\nStopping car services...\n'
        # Each service owns a process group, including its launched ROS nodes.
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

start_service ros2 launch lab1 car_launch.py "params_file:=$params_file" use_sim_time:=False
start_service ros2 launch slam_toolbox online_sync_launch.py "slam_params_file:=$slam_params_file"
start_service ros2 run lab1 ws_bridge_v2
start_service ros2 run lab1 bridge

printf '\nAll four processes started. Logs follow below. Ctrl+C stops all of them.\n'
result=0
wait -n "${pids[@]}" || result=$?
printf '\nA car service exited (status %s); stopping the remaining services.\n' "$result" >&2
if ((result == 0)); then result=1; fi
exit "$result"
