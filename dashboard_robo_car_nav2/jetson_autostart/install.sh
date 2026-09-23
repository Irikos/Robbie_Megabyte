#!/usr/bin/env bash
# ==============================================================================
# install.sh - Instalează și activează serviciul de autostart pe Jetson Nano
# Rulați pe Jetson Nano cu drepturi root: sudo bash install.sh
# ==============================================================================
set -eo pipefail

if [[ $EUID -ne 0 ]]; then
   echo "Acest script trebuie rulat cu sudo: sudo bash install.sh" >&2
   exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> 1. Copiere script pornire în /usr/local/bin/..."
cp "$SCRIPT_DIR/start_car_autostart.sh" /usr/local/bin/start_car_autostart.sh
chmod +x /usr/local/bin/start_car_autostart.sh

echo "==> 2. Copiere fișier de serviciu în /etc/systemd/system/..."
cp "$SCRIPT_DIR/car-autostart.service" /etc/systemd/system/car-autostart.service
chmod 644 /etc/systemd/system/car-autostart.service

echo "==> 3. Reîncărcare systemd daemon..."
systemctl daemon-reload

echo "==> 4. Activare serviciu la boot (enable)..."
systemctl enable car-autostart.service

echo "==> 5. Pornire serviciu acum (start)..."
systemctl restart car-autostart.service

echo ""
echo "=================================================================="
echo " GATA! Serviciul a fost instalat și activat cu succes."
echo "=================================================================="
echo "Comenzi utile:"
echo "  - Vezi logurile în timp real:  journalctl -u car-autostart.service -f"
echo "  - Vezi statusul:               systemctl status car-autostart.service"
echo "  - Oprește temporar:            sudo systemctl stop car-autostart.service"
echo "  - Repornește:                  sudo systemctl restart car-autostart.service"
echo "  - Dezactivează autostart:      sudo systemctl disable car-autostart.service"
echo "=================================================================="
