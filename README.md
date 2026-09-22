# Robbie Megabyte — Instalare de la zero + Ghid de folosire

Acest ghid te duce de la un robot **Unitree G1 (Jetson Orin) gol** până la un
dashboard de navigație Nav2 care merge, plus cum folosești efectiv aplicația
(poziționezi robotul, poziționezi mașinuța, pornești autonomia).

**Timp estimat:** ~45–60 min

**Repere fixe:** user `unitree` (`/home/unitree`) · folder
`/home/unitree/dashboard_robo_car_nav2` · interfață `enP8p1s0` · port `3003`

---

<details>
<summary><h2>0. Versiuni necesare</h2></summary>

| Componentă | Versiune |
|---|---|
| Placă | NVIDIA Jetson Orin (arm64 / aarch64) |
| Sistem de operare | Ubuntu **22.04** (arm64) |
| JetPack | 5.x |
| Python | **3.10** (vine cu Ubuntu 22.04) |
| ROS 2 | **Humble** |
| Nav2 | pachetele de Humble (secțiunea 3) |
| DDS | CycloneDDS (`rmw_cyclonedds_cpp`) |
| Interfețe Unitree | `unitree_ros2` / `cyclonedds_ws` |
| SDK Unitree Python | `unitree_sdk2_python` |

</details>

<details>
<summary><h1>PARTEA A — Instalare pe robot</h1></summary>

<details>
<summary><h3>1. Pachete de sistem</h3></summary>

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl wget build-essential cmake python3-pip \
    python3-dev net-tools iproute2 usbutils rsync
```

</details>

<details>
<summary><h3>2. ROS 2 Humble</h3></summary>

```bash
sudo apt install -y software-properties-common
sudo add-apt-repository universe -y
sudo curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key \
    -o /usr/share/keyrings/ros-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] \
http://packages.ros.org/ros2/ubuntu $(. /etc/os-release && echo $UBUNTU_CODENAME) main" \
    | sudo tee /etc/apt/sources.list.d/ros2.list > /dev/null
sudo apt update
sudo apt install -y ros-humble-ros-base ros-dev-tools \
    python3-colcon-common-extensions ros-humble-rmw-cyclonedds-cpp
source /opt/ros/humble/setup.bash
```

</details>

<details>
<summary><h3>3. Nav2 și pachetele ROS ale dashboardului</h3></summary>

```bash
sudo apt install -y \
    ros-humble-navigation2 ros-humble-nav2-bringup \
    ros-humble-nav2-bt-navigator ros-humble-nav2-controller \
    ros-humble-nav2-planner ros-humble-nav2-behaviors \
    ros-humble-nav2-collision-monitor ros-humble-nav2-velocity-smoother \
    ros-humble-nav2-lifecycle-manager \
    ros-humble-pointcloud-to-laserscan ros-humble-teleop-twist-keyboard \
    ros-humble-tf2-ros ros-humble-tf2-tools ros-humble-sensor-msgs-py
```

Verifică că sunt toate:

```bash
source /opt/ros/humble/setup.bash
for p in nav2_controller nav2_planner nav2_collision_monitor \
         nav2_velocity_smoother pointcloud_to_laserscan teleop_twist_keyboard; do
    ros2 pkg prefix $p >/dev/null && echo "OK $p" || echo "LIPSA $p"
done
```

</details>

<details>
<summary><h3>4. Interfețele ROS 2 Unitree (cyclonedds_ws) + cyclonedds.xml</h3></summary>

Dau mesajele `unitree_api` pe care le folosește dashboardul. Calea trebuie să fie
exact `/home/unitree/unitree_ros2/cyclonedds_ws`.

```bash
cd /home/unitree
git clone https://github.com/unitreerobotics/unitree_ros2.git
cd unitree_ros2/cyclonedds_ws
colcon build --packages-select cyclonedds
source /opt/ros/humble/setup.bash
colcon build
source install/setup.bash
python3 -c "from unitree_api.msg import Request, Response; print('unitree_api OK')"
```

**Fișierul `cyclonedds.xml`** (îl faci de la zero, cu interfața `enP8p1s0`):

```bash
cat > /home/unitree/cyclonedds.xml <<'XML'
<?xml version="1.0" encoding="UTF-8" ?>
<CycloneDDS xmlns="https://cdds.io/config"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="https://cdds.io/config https://raw.githubusercontent.com/eclipse-cyclonedds/cyclonedds/master/etc/cyclonedds.xsd">
    <Domain Id="any">
        <General>
            <Interfaces>
                <NetworkInterface name="enP8p1s0" priority="default" multicast="default" />
            </Interfaces>
        </General>
    </Domain>
</CycloneDDS>
XML
```

> Dacă interfața spre robot are alt nume (verifici cu `ip -4 addr`), înlocuiește
> `enP8p1s0` cu numele corect, aici și în `backend/robot_client.py`.

</details>

<details>
<summary><h3>5. SDK-ul Unitree pentru Python (SportClient + camera)</h3></summary>

Dă controlul de locomoție (SportClient) și scriptul camerei `send_video_depth.py`.

```bash
cd /home/unitree
git clone https://github.com/unitreerobotics/unitree_sdk2_python.git
cd unitree_sdk2_python && pip3 install -e .
ls /home/unitree/unitree_sdk2_python/send_video_depth.py   # trebuie să existe
```

</details>

<details>
<summary><h3>6. Driver LiDAR Mid360 — Livox SDK2 (opțional)</h3></summary>

Doar dacă folosești fallback-ul local Mid360. Dacă SLAM-ul nativ publică deja
norul de puncte, poți sări peste.

```bash
cd /home/unitree
git clone https://github.com/Livox-SDK/Livox-SDK2.git
cd Livox-SDK2 && mkdir -p build && cd build && cmake .. && make -j$(nproc)
```

</details>

<details>
<summary><h3>7. Cameră RealSense</h3></summary>

```bash
sudo apt install -y ros-humble-librealsense2* || true
pip3 install pyrealsense2
```

</details>

<details>
<summary><h3>8. Dependențele Python ale dashboardului</h3></summary>

```bash
python3 -m pip install --upgrade pip
pip3 install \
    fastapi "uvicorn[standard]" wsproto aiofiles python-multipart \
    websockets paramiko asyncio-mqtt \
    numpy opencv-python pygame ultralytics pyrealsense2 pytest
```

| Pachet | Folosință |
|---|---|
| fastapi, uvicorn[standard], wsproto, aiofiles, python-multipart | serverul web + WebSocket |
| websockets, paramiko, asyncio-mqtt | bridge-uri / SSH / mqtt |
| numpy, opencv-python (`cv2`), pygame | procesare imagini / UI |
| ultralytics | detecția YOLO |
| pyrealsense2 | camera RealSense |
| pytest | testele (opțional) |

**Atenție pe Jetson — PyTorch pentru YOLO:** `ultralytics` trage un `torch` fără
CUDA pe Jetson (YOLO merge pe CPU, lent). Pentru GPU, instalează întâi wheel-ul de
PyTorch pentru JetPack-ul tău (de la NVIDIA, „PyTorch for Jetson"), apoi
`ultralytics`. Dacă nu-ți pasă acum de viteza YOLO, lasă-l pe CPU.

**Dacă la rulare dă `ModuleNotFoundError: cyclonedds`:**

```bash
export CYCLONEDDS_HOME=/home/unitree/unitree_ros2/cyclonedds_ws/install/cyclonedds
pip3 install cyclonedds
```

</details>

<details>
<summary><h3>9. Codul dashboardului și hărțile</h3></summary>

```bash
cd /home/unitree
git clone https://github.com/Irikos/Robbie_Megabyte.git
cp -R Robbie_Megabyte/dashboard_robo_car_nav2 /home/unitree/dashboard_robo_car_nav2
cd /home/unitree/dashboard_robo_car_nav2
chmod +x start_dashboard.sh
```

**Hărțile nu sunt în git** (sunt mari). Dashboardul le citește din folderul lui,
adică `/home/unitree/dashboard_robo_car_nav2/maps/`. 

**Modelul YOLO** `yolov8s.pt` nu e în git — se descarcă singur la prima detecție
sau îl copiezi tu lângă `backend/`.

</details>

<details>
<summary><h3>10. Pornire</h3></summary>

```bash
cd /home/unitree/dashboard_robo_car_nav2
bash start_dashboard.sh
```

Pornește automat și stack-ul Nav2 și camera. În terminal apare linkul cu token:
`http://<IP>:3003/?token=...`.

</details>

</details>

<details>
<summary><h1>PARTEA B — Pornire din laptop</h1></summary>

Nu instalezi nimic pe laptop; te conectezi la robot și pornești acolo:

```bash
ssh unitree@<IP_ROBOT>
cd /home/unitree/dashboard_robo_car_nav2
bash start_dashboard.sh
```

Apoi deschizi în browserul de pe laptop linkul afișat în terminal:
`http://<IP_ROBOT>:3003/?token=...`. Oprire: `Ctrl+C` în terminal.

</details>

<details>
<summary><h1>PARTEA C — Cum folosești aplicația (pas cu pas)</h1></summary>

Ordinea: **pregătești robotul -> localizezi robotul pe hartă -> localizezi mașinuța
-> confirmi mișcarea din taste -> pornești navigația autonomă.**

> Siguranță: la primul test ține robotul asigurat și mâna pe STOP. Traseu scurt,
> viteză mică. Nu porni „drumul lung" din prima.

<details>
<summary><h3>1. Pregătește robotul (panoul „Mod robot")</h3></summary>

- Introdu **parola modului robot** ca să deblochezi controlul.
- Adu robotul gata de mers: **Damp** -> **Ready** -> **Run**.
  (`Run` = locomoție pornită. Fără Run, robotul nu execută nicio comandă de mers.)
- Parola de confirmare este: **123**

</details>

<details>
<summary><h3>2. Încarcă harta și localizează robotul</h3></summary>

Panoul „Hartă și localizare":
- Alege harta din listă.
- Pune robotul pe hartă în poziția reală și apasă **Încarcă și localizează**.
- Reglează **orientarea** cu butoanele `↑ 90°`, `-> 0°`, `↓ −90°`, `← 180°`,
  `↻ Inversează (±180°)` — până când săgeata robotului bate cu realitatea.
- Opțional, potrivire mai bună a pereților: **✦ Lipește pereț (ICP)**.
- Așteaptă ca poziția afișată să fie stabilă (nu o valoare implicită falsă).

</details>

<details>
<summary><h3>3. Localizează mașinuța (panoul „Mașinuță + G1")</h3></summary>

- **Localizare mașinuță** -> **Previzualizează mașinuță** -> dacă poziția e bună,
  **Confirmă mașinuță**.
- Ai și: **Potrivește automat hărțile** (aliniere automată robot–mașinuță),
  **Centrează pe mașinuță**, **Trimite poziția către AMCL mașinuță**, sau
  **Mod direct (fără aliniere)**.

</details>

<details>
<summary><h3>4. Confirmă mișcarea din taste (obligatoriu înainte de autonom)</h3></summary>

Nav2 rămâne **blocat** până când robotul chiar s-a mișcat o dată din taste
(așa confirmăm că locomoția merge, separat de planificare).

- Apasă **Activează teleop** și ține pagina în față (focus pe fereastră).
- Mișcă robotul cu **WASD** sau **săgeți**; **Space** = stop.
- După ce s-a mișcat vizibil, apasă **Oprește teleop**.

</details>

<details>
<summary><h3>5. Pornește navigația autonomă (panoul „Navigație")</h3></summary>

- Dă click pe hartă în punctul unde vrei să ajungă robotul (ținta B).
- **⌁ Previzualizează** — Nav2 calculează ruta și o desenează. **Nu mișcă robotul.**
- Verifică ruta desenată (să nu treacă prin obstacole).
- **Confirmă și pornește** — ăsta e „merge": robotul pleacă autonom pe rută.
- În timpul mersului: ** Pauză** (cu reluare), ** Stop / Oprește ruta** (oprire completă).

</details>

<details>
<summary><h3>6. Alte butoane utile</h3></summary>

- **Pornește YOLO** — detecția pe fluxul camerei.
- **Cartografiere** (Mapping) — hartă nouă: pornești mapping, plimbi robotul, apoi
  **Salvează** / **Descarcă PCD**.
- **2D / 3D / Ambele** — cum vezi harta. **Urmărește robotul** — camera urmează robotul.

</details>

<details>
<summary><h3>Rezumatul fluxului</h3></summary>

```
Mod robot: Run  ->  Încarcă+localizează robotul (poziție + orientare)
   ->  Localizează mașinuța (Previzualizează -> Confirmă)
   ->  Activează teleop, mișcă din WASD, Oprește teleop
   ->  Click pe țintă -> ⌁ Previzualizează -> Confirmă și pornește
   ->  (Pauză / Stop când vrei)
```

</details>

</details>

<details>
<summary><h1>Depanare rapidă</h1></summary>

| Problemă | Ce faci |
|---|---|
| `Pachet ROS 2 Nav2 lipsă` | reia secțiunea 3 |
| `unitree_api` / `nav2_msgs` la import | sursează ROS + workspace Unitree (secțiunea 4) |
| `Există deja un stack Nav2` | rulezi și serviciul și manual — oprește unul: `sudo systemctl stop robocar-dashboard` |
| `Portul 3003 ocupat` | oprește instanța veche, sau alt port: `ROBOTCAR_PORT=3005 bash start_dashboard.sh` |
| Nav2: `Invalid frame ID "odom"` | nu ajunge TF/odometria pelvisului la Nav2; verifică localizarea și că motorul Nav2 a pornit |
| Nu apar hărți în UI | copiază-le în `/home/unitree/dashboard_robo_car_nav2/maps/` |
| Robotul nu pleacă la „Confirmă și pornește" | n-ai făcut pasul 4 (mișcare din taste), sau nu e în `Run` |
| Camera: `No device connected` | RealSense neconectată sau ocupată de altă aplicație |

</details>

<details>
<summary><h1>Rezumat minim „ca să meargă"</h1></summary>

1. ROS 2 Humble + Nav2 (secțiunile 2–3)
2. `unitree_ros2/cyclonedds_ws` + `cyclonedds.xml` (secțiunea 4)
3. `unitree_sdk2_python` (secțiunea 5)
4. dependențe Python (secțiunea 8)
5. cod + hărți în `maps/` (secțiunea 9)
6. `bash start_dashboard.sh` -> deschizi `http://<IP>:3003` (secțiunea 10)
7. în aplicație: Run -> localizezi robotul -> localizezi mașinuța -> teleop -> Previzualizează -> Confirmă și pornește (Partea C)

</details>
