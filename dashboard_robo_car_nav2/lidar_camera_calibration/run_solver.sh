#!/usr/bin/env bash
set -euo pipefail

TOOL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${G1_CALIBRATION_DATA_DIR:-$TOOL_DIR/data}"

exec python3 "$TOOL_DIR/solve_lidar_camera.py" "$DATA_DIR" "$@"
