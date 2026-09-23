# Autostart Jetson Nano: Docker `jammy2` + `start_car_common.sh`

Aceste fișiere permit pornirea automată a containerului Docker `jammy2` și a serviciilor ROS 2 ale mașinii (`start_car_common.sh`) de fiecare dată când Jetson Nano pornește sau este alimentat.

## Instalare pe Jetson Nano

1. Asigură-te că fișierele sunt copiate pe Jetson Nano.
2. Din directorul `scripts/jetson_autostart/`, rulează:
   ```bash
   sudo bash install.sh
   ```

## Ce face instalarea:
1. Copiază [start_car_autostart.sh](file:///home/matei/Robbie_Megabyte/dashboard_robo_car_nav2/scripts/jetson_autostart/start_car_autostart.sh) în `/usr/local/bin/start_car_autostart.sh`.
2. Configurează serviciul systemd [car-autostart.service](file:///home/matei/Robbie_Megabyte/dashboard_robo_car_nav2/scripts/jetson_autostart/car-autostart.service) în `/etc/systemd/system/car-autostart.service`.
3. Îl activează la boot (`systemctl enable car-autostart.service`).

## Comenzi utile pentru operare:

- **Vizualizare loguri în timp real:**
  ```bash
  journalctl -u car-autostart.service -f
  ```

- **Verificare status serviciu:**
  ```bash
  systemctl status car-autostart.service
  ```

- **Oprire manuală:**
  ```bash
  sudo systemctl stop car-autostart.service
  ```

- **Repornire:**
  ```bash
  sudo systemctl restart car-autostart.service
  ```

- **Intrare manuală în container pentru depanare:**
  ```bash
  docker exec -it jammy2 bash
  ```
