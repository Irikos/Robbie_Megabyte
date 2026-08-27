#!/usr/bin/env bash

SCRIPT_DIR="$(
    cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null &&
    pwd
)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"

MODE="${1:-normal}"

case "$MODE" in
    normal)
        BASE="$CPT_ROOT/perception/runtime/live_gvhmr_pair_prio2_interactive_test.py"
        ;;
    preview)
        BASE="$CPT_ROOT/camera/previews/live_gvhmr_pair_prio2_interactive_test_preview.py"
        ;;
    keypoints)
        BASE="$CPT_ROOT/camera/previews/live_gvhmr_pair_prio2_interactive_keypoint_preview.py"
        ;;
    dual)
        BASE="$CPT_ROOT/camera/previews/live_gvhmr_pair_prio2_interactive_test_dual_preview.py"
        ;;
    *)
        echo "Usage: $0 [normal|preview|keypoints|dual]"
        false
        ;;
esac

WRAPPER="$CPT_ROOT/sonic/runtime/live_gvhmr_pair_prio2_sonic_async_interactive.py"

missing=0

for path in \
    "$GVHMR_ROOT" \
    "$GENMO_ROOT" \
    "$SONIC_ROOT" \
    "$TORCH2TRT_ROOT" \
    "$POSE_PYTHON" \
    "$TRT8_PYTHON_DIR" \
    "$TRT8_LIB_DIR" \
    "$TRT10_LIB_DIR" \
    "$VITPOSE_TRT_STATE" \
    "$HMR2_ONNX" \
    "$HMR2_TRT_CACHE" \
    "$GRAVITY_FILE" \
    "$F_LEFT_FILE" \
    "$PUBLISHER_SOURCE_DIR/soma_to_smpl.py" \
    "$BASE" \
    "$WRAPPER"
do
    if [ ! -e "$path" ]; then
        echo "MISSING: $path"
        missing=1
    fi
done

if [ -z "${CAMERA_DEVICE:-}" ]; then
    echo "MISSING: CAMERA_DEVICE in configs/local.env"
    missing=1
elif [ ! -e "$CAMERA_DEVICE" ]; then
    echo "MISSING CAMERA DEVICE: $CAMERA_DEVICE"
    missing=1
fi

if [ "$missing" -ne 0 ]; then
    echo
    echo "Environment incomplete."
    echo "Run:"
    echo "  ./scripts/check_environment.sh"
    false
else
    GEN_NVIDIA_LIBS="$(
        find "$GENMO_ROOT/.venv" \
            -type d \
            -path '*/site-packages/nvidia/*/lib' \
            -print 2>/dev/null \
        | sort \
        | paste -sd: -
    )"

    export PYTHONPATH="$TRT8_PYTHON_DIR:$TORCH2TRT_ROOT:$CPT_ROOT/retargeting:$CPT_ROOT/sonic/runtime:$GENMO_ROOT:$GVHMR_ROOT${PYTHONPATH:+:$PYTHONPATH}"

    export LD_LIBRARY_PATH="$TRT10_LIB_DIR:$TRT8_LIB_DIR${GEN_NVIDIA_LIBS:+:$GEN_NVIDIA_LIBS}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

    export LIVE_GVHMR_GV="$GVHMR_ROOT"
    export LIVE_GVHMR_CAM="$CAMERA_DEVICE"
    export LIVE_GVHMR_VIT_STATE="$VITPOSE_TRT_STATE"
    export LIVE_GVHMR_HMR_ONNX="$HMR2_ONNX"
    export LIVE_GVHMR_HMR_CACHE="$HMR2_TRT_CACHE"

    export SONIC_ROOT
    export SONIC_EMA_WEIGHT

    mkdir -p "$RUNTIME_ROOT/logs"

    STAMP="$(date +%Y%m%d_%H%M%S)"
    export LIVE_GVHMR_OUT_PREFIX="$RUNTIME_ROOT/logs/live_${MODE}_${STAMP}"

    BASE_SHA="$(sha256sum "$BASE" | awk '{print $1}')"

    echo "============================================================"
    echo "Camera Pose Teleop"
    echo "============================================================"
    echo "mode:            $MODE"
    echo "camera:          $CAMERA_DEVICE"
    echo "pose port:       $SONIC_POSE_PORT"
    echo "pose topic:      $SONIC_POSE_TOPIC"
    echo "EMA weight:      $SONIC_EMA_WEIGHT"
    echo "output:          $LIVE_GVHMR_OUT_PREFIX"
    echo "============================================================"

    cd "$GVHMR_ROOT" || false

    "$POSE_PYTHON" -u "$WRAPPER" \
        --base-runner "$BASE" \
        --expected-base-sha "$BASE_SHA" \
        --sonic-root "$SONIC_ROOT" \
        --publisher-source-dir "$PUBLISHER_SOURCE_DIR" \
        --sonic-mode publish \
        --sonic-port "$SONIC_POSE_PORT" \
        --sonic-topic "$SONIC_POSE_TOPIC" \
        --gravity-file "$GRAVITY_FILE" \
        --calibration-reference "$F_LEFT_FILE" \
        2>&1 \
    | tee "${LIVE_GVHMR_OUT_PREFIX}_console.log"
fi
