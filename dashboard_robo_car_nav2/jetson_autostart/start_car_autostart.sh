#!/usr/bin/env bash
# ==============================================================================
# start_car_autostart.sh - Script de pornire automată pentru Jetson Nano (pe HOST)
# Pornește containerul Docker 'jammy2' și rulează 'start_car_common.sh' în el.
# ==============================================================================
set -eo pipefail

CONTAINER_NAME="jammy2"
SCRIPT_INSIDE="/root/humble_ws/start_car_common.sh"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] [AUTOSTART] Așteptare ca serviciul Docker să fie activ..."
until docker info >/dev/null 2>&1; do
    sleep 2
done

# Verifică dacă containerul există
if ! docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [EROARE] Containerul '$CONTAINER_NAME' nu a fost găsit pe acest Jetson!" >&2
    exit 1
fi

# Pornește containerul dacă este oprit
if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null)" != "true" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [AUTOSTART] Pornire container $CONTAINER_NAME..."
    docker start "$CONTAINER_NAME"
    sleep 3
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [AUTOSTART] Containerul $CONTAINER_NAME rulează deja."
fi

# Opțional: Oprește instanțe vechi ale scriptului dacă au rămas blocate
docker exec "$CONTAINER_NAME" pkill -f "start_car_common.sh" 2>/dev/null || true
sleep 1

ROS_DOMAIN_ID_VALUE="${CAR_ROS_DOMAIN_ID:-52}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] [AUTOSTART] Lansare $SCRIPT_INSIDE în containerul $CONTAINER_NAME (ROS_DOMAIN_ID=$ROS_DOMAIN_ID_VALUE)..."

# Executăm scriptul în container transmițând explicit domeniul ROS (ROS_DOMAIN_ID și CAR_ROS_DOMAIN_ID)
exec docker exec -i \
    -e ROS_DOMAIN_ID="$ROS_DOMAIN_ID_VALUE" \
    -e CAR_ROS_DOMAIN_ID="$ROS_DOMAIN_ID_VALUE" \
    "$CONTAINER_NAME" /bin/bash "$SCRIPT_INSIDE"
