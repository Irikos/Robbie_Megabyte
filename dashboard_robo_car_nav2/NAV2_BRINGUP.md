# robot+car — Punere în funcțiune Nav2 și test fizic

Acest document este obligatoriu înainte de orice mișcare autonomă. Codul
**nu a fost rulat pe robot** în timpul construirii — a fost verificat doar la
nivel de sintaxă/import. Tratează prima pornire ca pe un bring-up, nu ca pe o
versiune deja validată.

## 0. Precondiții pe robot

- ROS 2 Humble + workspace-ul Unitree (`cyclonedds_ws`) sursate.
- Stack-ul Nav2 instalat: `nav2_controller`, `nav2_planner`, `nav2_behaviors`,
  `nav2_bt_navigator`, `nav2_velocity_smoother`, `nav2_collision_monitor`,
  `nav2_lifecycle_manager`, `pointcloud_to_laserscan`. `start_dashboard.sh`
  verifică prezența lor și se oprește cu eroare clară dacă lipsesc.
- Niciun alt stack Nav2 nu rulează deja (scriptul refuză dacă există deja
  `/navigate_to_pose`).
- Copiază folderul `robot+car` pe robot (ex. în `~/` sau unde ții dashboardurile).
  Calea de pe Mac (`~/Desktop/robot+car`) este doar pentru editare.

## 1. Pornire

```bash
cd <cale>/robot+car/dashboard_slam_nav2
bash start_dashboard.sh
```

Se pornesc, în ordine: stack-ul Nav2 (`nav2v3/bringup.launch.py`), camera
RealSense (dacă există `send_video_depth.py`) și backend-ul pe `:3003`.
Deschide `http://<IP>:3003/?token=...` (tokenul apare în terminal).

`start_dashboard.sh` nu acceptă flaguri CLI legacy (teleop se activează exclusiv
din pagina v2, din butonul „Activează teleop").

## 2. Verificări înainte de mișcare (fără robot în mers)

Fluxul UI rămâne: **selectează harta → localizare (poziție + orientare) →
preview → preflight → confirmă/start**.

`/api/nav/preflight` (și indicatorul „Protecție autonomie" din UI) trebuie să
arate toate verde:

| Verificare | Ce înseamnă |
|---|---|
| `map_loaded`, `localization_mode`, `localization_fresh` | hartă încărcată, mod localization, poziție ICP recentă |
| `camera/lidar/obstacle_sensors_fresh` | RealSense + LiDAR proaspete |
| `nav2_adapter_available` | motorul Nav2 (`nav2_engine`) a pornit |
| `nav2_tf_ready` | TF `map→odom→base_link` publicat (poză + odom ajung la Nav2) |
| `nav2_map_published` | harta PCD a fost rasterizată în `/map` |
| `nav2_scan_fresh` | `/scan` proaspăt (din `pointcloud_to_laserscan`) |
| `fsm_locomotion_ready` | FSM-ul locomotor e în RUN (500/501/502 sau 801/802) |

Dacă `nav2_map_published` nu devine verde, ajustează banda de înălțime a hărții
2D (obstacole vs. podea) cu variabilele de mediu înainte de pornire:

```bash
export ROBOTCAR_NAV2_MAP_MIN_Z=0.15   # implicit
export ROBOTCAR_NAV2_MAP_MAX_Z=1.80   # implicit
```

Dacă `/scan` folosește alt topic de nor de puncte:

```bash
export G1_NAV2_CLOUD_TOPIC=/utlidar/cloud_livox_mid360   # implicit
```

Preview-ul (`ComputePathToPose`) **nu produce mișcare**; folosește-l ca să
confirmi că Nav2 chiar găsește o rută pe harta ta înainte de primul start.

## 3. Primul test fizic (obligatoriu, ca în README v4)

1. Oprește orice alt dashboard/Nav2/publisher locomotor.
2. Asigură robotul, ține mâna pe **STOP**, eliberează ≥1.5 m în jur.
3. Adu robotul în RUN (Wake-up / Start) și confirmă FSM-ul în preflight.
4. Previzualizează o rută **scurtă** (~1 m) și pornește la **0.60 m/s**, cu
   operatorul lângă oprirea de urgență.
5. Crește viteza (până la 0.80 m/s) **numai** după ce ai confirmat direcțiile
   și oprirea pe traseul scurt.
6. Pentru ocolire: pune obstacolul la ~1–1.5 m și lasă ≥0.55 m liberi pe o parte.

**Interpretare rapidă a unei opriri** (panoul de navigație arată vitezele pe
lanț): dacă 7105 e acceptat dar pelvisul nu se mișcă, problema e în
autoritatea locomotorie/FSM a robotului, **nu** în planificatorul Nav2
(`nav2_engine` semnalează explicit acest caz după ~6 s fără mișcare în
`odom_pelvis`).

## 4. Ce trebuie neapărat validat pe robot (nu am putut de aici)

- Că `map→odom→base_link` e coerent: poza de localizare a mașinii
  (`map_state["pose"]`, sursă `local_lidar_icp`) și `odom_pelvis` trebuie să
  urmărească aceeași mișcare fizică. Ancora `map→odom` din `nav2_runtime` se
  bazează pe această coerență.
- Că rasterizarea hărții 2D în `/map` produce pereți corecți (banda de înălțime
  de mai sus).
- Că topicul Collision Monitor de ieșire configurat în `nav2v3/nav2.yaml` este
  `/nav2/cmd_vel_safe` (motorul se abonează exact acolo). Este configurația
  originală din v4, dar merită confirmată pe robotul tău.
- Comportamentul teleop: pagina dashboardului pornește propriul
  `teleop_twist_keyboard` într-un pseudo-terminal (RUN → „Activează teleop" →
  tastează cu pagina focalizată); nu e „navigare" Nav2, dar testează-l separat
  înainte de autonomie. `start_teleop_keyboard.sh` e doar un instrument manual
  de diagnostic — NU-l rula simultan cu teleoperarea din browser, altfel
  „Activează teleop" e respins explicit (publisher extern deja pe
  `/cmd_vel_teleop`).

## 5. Curățenie opțională

Fișierele A* au fost mutate în
`dashboard_slam_nav2/backend/_A_star_removed/` (nu am permisiune să le șterg).
Le poți șterge din Finder când ești sigur că nu mai ai nevoie de ele:
`autonomous_navigation.py`, `tests/test_autonomous_navigation.py`,
`tests/test_nav2_v24.py`, plus scripturile vechi ale observer-ului Nav2.
