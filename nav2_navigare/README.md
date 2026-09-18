# G1 Dashboard Nav2 v3

Versiune separată de v5/v6. Navigația A→B este realizată de Nav2; dashboardul
nu trimite și refuză API-urile navigatorului nativ Unitree `1102`, `1201` și
`1202`. Niciun fișier din versiunile anterioare și nicio configurare globală
ROS/DDS nu sunt modificate.

V3 pornește din funcțiile validate în v1, dar are identitate, port, token,
procese și fișiere temporare proprii. Nu importă `unitree_sdk2py`: toate
mesajele către robot sunt publicate cu `rclpy` și `unitree_api` din workspace-ul
ROS 2 Unitree.

## Arhitectură

```text
PCD 2D ───────────────> /map ───────────────┐
localizare Unitree ROS2 ─> map→odom         │
odom_pelvis ────────────> odom→base_link    ├─> Nav2
Mid360 -> pointcloud_to_laserscan -> /scan ─┘

ComputePathToPose              = preview
NavigateToPose                 = execuție + replanificare
controller_server              -> /nav2/cmd_vel_nav2 -> selector exclusiv
selector                       -> /nav2/cmd_vel_raw
velocity_smoother              -> /nav2/cmd_vel_smoothed
collision_monitor              -> /nav2/cmd_vel_safe
teleop_twist_keyboard          -> /cmd_vel_teleop ────┐
/nav2/cmd_vel_safe ------------------------------------┴> transformare manuală base_link -> adaptor unic -> Sport API 7105
```

Nav2 decide ruta, virajele, viteza și evitarea obstacolelor. Controllerul de
echilibru/mers al robotului rămâne inevitabil stratul care execută o viteză de
corp; dashboardul nu comandă articulațiile și nu folosește navigatorul nativ.
Adaptorul comunică exclusiv prin mesaje ROS 2 `unitree_api`, nu prin
`unitree_sdk2py`. Transformarea manuală este în
`backend/motion_adapter.py`: `(linear.x, linear.y, angular.z)` din `base_link`
devine explicit `[vx înainte, vy stânga, yaw_rate CCW]` pentru 7105. Comanda
Nav2 este deja în cadrul corpului, deci nu este rotită încă o dată cu yaw-ul
global. Nu există gain sau viteză minimă după Collision Monitor; un zero ori o
reducere de siguranță rămâne neschimbată.

## Ce este intenționat unic

- o singură hartă de cost statică, publicată în `/map`;
- o singură inflație per costmap, în `nav2/nav2.yaml`;
- exact o sursă activă la un moment dat: `teleop`, `nav2` sau `disabled`;
- exact două intrări exclusive în adaptor: teleop direct sau ieșirea sigură Nav2;
- o singură limitare finală și un singur watchdog în backend;
- o singură acțiune de rută: `NavigateToPose`;
- pauza este anulare Nav2 cu destinația memorată, nu API `1201`;
- butonul RUN citește mai întâi MotionSwitcher (`1001`) și folosește exact
  serviciul activ: `ai` → `7111` + FSM `801/802/812`, respectiv `normal` →
  `7110` + FSM `500/501/502`; ambele aplică profilul `7107=1`;
- Nav2 rămâne blocat până când o comandă teleop a produs mișcare confirmată în
  `odom_pelvis`; astfel separăm o problemă de autoritate locomotorie de una de
  planificare.

Verificările pentru `1102/1201/1202` apar la două granițe intenționate
(`command` și publicarea ROS) ca protecție fail-closed, nu ca algoritmi
suprapuși.

## Pornire

```bash
cd /home/unitree/dashboard_g1_nav2_v3
bash start_dashboard.sh
```

Port implicit: `3019`. Se poate schimba numai pentru procesul acesta cu
`G1_NAV2_V3_PORT`. Launcherul pornește nodurile Nav2 și backendul, apoi oprește
doar procesele pe care le-a creat.

Fluxul UI rămâne: selectare hartă → localizare → preview → confirmare → start.
Preview folosește `ComputePathToPose`, deci nu poate produce mișcare.

## Teleoperare din taste

Teleoperarea folosește chiar pachetul ROS 2 `teleop_twist_keyboard`, pornit de
backend într-un pseudo-terminal dedicat. Nu folosește controllerul de navigație
Unitree și nu cere al doilea terminal.

Ordinea sigură este: pornește dashboardul → introdu parola `123` → apasă
`Activează teleop` → păstrează pagina focalizată. Butonul confirmat trece
robotul în WALKRUN/RUN dacă este necesar, pornește nodul de tastatură și armează
selectorul exclusiv. Tastele principale sunt săgețile sau WASD, respectiv
`i` înainte, `,` înapoi, `j/l` rotire și `k`/Space pentru stop.

Armarea nu mișcă robotul. Pagina trimite tastele către pseudo-terminalul
procesului, iar acesta publică ROS `Twist`. La eliberarea tastei și la pierderea
focusului se trimite `k`. Sliderele teleop aleg limita liniară între
`0,10–0,80 m/s` și limita unghiulară între `0,30–1,60 rad/s`; ambele pot fi
modificate cât timp teleop este armat. Teleop are o singură scalare finală în
adaptor și nu mai este copiat prin pipeline-ul Nav2. Mișcarea laterală este
limitată suplimentar la `±0,25 m/s`, iar comenzile au un watchdog propriu
de 0,4 s. Teleop nu depinde de lifecycle-ul Nav2; scopul lui
este să valideze separat gait-ul și API 7105. Navigația autonomă rămâne pe
velocity smoother și Collision Monitor. Butonul `Oprește teleop` închide
procesul, dezarmează selectorul și trimite viteză zero.

`start_teleop_keyboard.sh` rămâne numai ca instrument manual de diagnostic și
nu trebuie rulat simultan cu teleoperarea din browser; armarea refuză explicit
un publisher extern existent pe `/cmd_vel_teleop`.

## Parametri de bază

- footprint G1: față `0.34 m`, spate `0.25 m`, lateral `±0.25 m`;
- padding: `0.01 m`;
- inflation radius: `0.28 m` în costmapul local și global;
- interval viteză Nav2: `0.30–0.80 m/s`, implicit `0.60 m/s`;
- rotație Nav2: comandă și limită finală `1.60 rad/s`, toleranță yaw `0.12 rad`;
- RPP corectează din mers abaterile sub `0.785 rad` (45°); rotația inițială
  pe loc este rezervată nealinierilor mari, iar orientarea finală rămâne activă;
- accelerația internă RPP/Spin este `32 rad/s²`, astfel încât plafonul calculat
  la `20 Hz` să permită întreaga comandă de `1.60 rad/s` chiar dacă odometria
  indică încă zero; accelerația fizică rămâne netezită separat de velocity
  smoother la `4 rad/s²`;
- teleop liniar: `0.10–0.80 m/s`; teleop unghiular: `0.30–1.60 rad/s`;
- comenzi Sport: maximum `10 Hz`, durată `0.65 s` pentru a tolera latența răspunsului;
- watchdog teleop: `0.40 s`; ieșirea sigură Nav2: `0.75 s`;
- o pauză fără comandă la replanificare trimite zero către robot fără să anuleze
  acțiunea; zero-ul este injectat prin smoother și Collision Monitor, nu direct
  la 7105;
- Collision Monitor poate înceta normal să repete zero după `stop_pub_timeout`;
  watchdog-ul nu mai confundă această stare cu un pipeline defect;
- numai o intrare Nav2 nenulă fără ieșire sigură oprește imediat actuatorul;
  ruta este anulată doar dacă fluxul nu revine în `2 s`;
- Collision Monitor direcțional pentru comenzile autonome Nav2;
- ruta este recalculată la `2 Hz`; recovery-ul așteaptă fără să șteargă
  obstacolele live din costmap;
- după prima comandă nenulă, progresul este verificat în `odom_pelvis`; lipsa
  mișcării timp de `1,5 s` la teleop sau `6 s` la Nav2 oprește comanda și
  indică explicit locomotion/FSM;
- scanul elimină numai punctele aflate fizic în interiorul footprintului.

Panoul de navigație afișează simultan vitezele de la controller, selector,
smoother, Collision Monitor și vectorul trimis la 7105. Afișează și yaw-ul
țintei, yaw-ul `map→base_link`, yaw-ul odometric și eroarea finală; astfel o
scădere de la 1.60 la 0.20 rad/s poate fi localizată fără presupuneri.

## Limită importantă înainte de test fizic

Un ACK cu cod zero la API `7105` nu demonstrează că firmware-ul a acordat
autoritatea de mers. De aceea dashboardul nu este pornit și nu s-a executat
nicio comandă de mișcare în timpul construirii. Primul test trebuie făcut cu
robotul asigurat, traseu scurt și operator lângă oprirea de urgență. Dacă
`7105` este acceptat dar pelvisul nu se deplasează, problema este în autoritatea
locomotorie/FSM a firmware-ului, nu în planificatorul Nav2.

## Primul test fizic V3

1. Oprește orice alt dashboard, Nav2 sau publisher locomotor.
2. Pornește V3 și verifică teleop la `0.50 m/s` și `1.00 rad/s`; Nav2 rămâne
   blocat până când odometria confirmă că robotul chiar s-a mișcat.
3. Încarcă harta, previzualizează o rută scurtă și începe la `0.60 m/s`, cu
   operatorul lângă oprirea de urgență. Limita `0.80 m/s` se testează numai
   după confirmarea direcțiilor și a opririi.
4. La orientarea finală urmărește rândurile `controller`, `selector`,
   `smoother`, `collision`, `ROS→7105` și `yaw goal/base` din dashboard.
5. Pentru ocolire, pune obstacolul la circa `1–1.5 m` și lasă minimum
   `0.55–0.60 m` liberi pe una dintre părți.

Interpretarea diagnosticului: `controller ≠ selector` indică selecția sursei;
`selector ≠ smoother` indică rampa de accelerație; `smoother ≠ collision`
indică o limitare de siguranță; `collision ≠ ROS→7105` indică adaptorul final.
În configurația implicită, ultimul caz apare numai la limitele declarate, nu
prin scalare ascunsă.

## Corecții după primul test fizic

- `controller_frequency` este `20 Hz`;
- lookahead-ul a fost redus la `0.40 m`, maximum `0.65 m`, pentru a nu mai tăia
  excesiv colțurile traseului;
- decelerarea normală este limitată la `0.50 m/s²` longitudinal și `2.00 rad/s²`
  unghiular;
- la tăcerea controllerului, zero trece prin velocity smoother și Collision
  Monitor; un obstacol real poate în continuare opri imediat după smoother;
- timeout-ul sursei LiDAR din Collision Monitor este `0.60 s`, egal cu limita
  de sănătate a scanului din backend, pentru a tolera jitter DDS scurt;
- pragul Collision Monitor este de cinci puncte, conform exemplului footprint
  approach livrat cu Nav2 Humble, reducând reacțiile la câteva puncte izolate.

## Verificări offline

```bash
source /opt/ros/humble/setup.bash
source /home/unitree/unitree_ros2/cyclonedds_ws/install/setup.bash
cd /home/unitree/dashboard_g1_nav2_v3
export PYTHONPATH="$PWD/backend${PYTHONPATH:+:$PYTHONPATH}"
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -q backend/tests
bash -n start_dashboard.sh
```
