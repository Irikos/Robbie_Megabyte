# dashboard_g1_a*_v5

Dashboard nou și independent pentru G1. Nu conține și nu importă cod din v4.

## Arhitectură

- ROS 2 Humble cu `rmw_cyclonedds_cpp`.
- Două noduri `rclpy` în același proces: unul pentru cloud/control și unul
  foarte ușor pentru odometrie, ca norii Mid360 mari să nu întârzie poziția.
- `unitree_sdk2py` nu este folosit; nu există două biblioteci `libddsc` în proces.
- Cartografierea folosește mecanismul 3D care a funcționat inițial: norul brut
  `/utlidar/cloud_livox_mid360`, extrinsecul Mid360→G1 și poziția completă
  (inclusiv yaw) din `/state_estimator/odom_pelvis`.
- Fiecare cadru este transformat o singură dată în cadrul sesiunii și acumulat
  în voxelii 3D. Abia după transformare, punctele din banda −0,30…1,20 m sunt
  proiectate în celule XY de 5 cm pentru viewer și A*.
- `/unitree/slam_mapping/points` rămâne doar diagnostic. Cadrele sale nu sunt
  amestecate cu harta Mid360, deoarece au produs suprapunerea observată.
- Localizarea și navigația nativă cer în continuare răspunsul robotului pe
  `/api/slam_operate/response`.

Launcherul nu pornește sau oprește servicii SLAM/LiDAR și nu încarcă SDK-ul
Unitree. El pornește doar backendul ROS 2 al dashboardului; serviciile native
ale robotului rămân independente.

Launcherul supraveghează fiecare proces pe care îl pornește într-un grup de
procese separat. La `Ctrl+C`, închiderea terminalului, `SIGTERM` sau oprirea
serverului web, închide controlat Uvicorn. După maximum șase secunde termină
forțat numai copilul propriu și eliberează automat lock-ul și fișierul PID;
procesele ROS existente înainte de launcher nu sunt atinse.

Închiderea simplă a tabului din browser nu oprește serverul. Dashboardul se
oprește din terminal cu `Ctrl+C`.

## Pornire

```bash
cd '/home/unitree/dashboard_g1_a*_v5'
bash start_dashboard.sh
```

Poți deschide și adresa simplă; backendul redirecționează automat browserul
către tokenul propriu v5 și înlocuiește un token vechi păstrat în sesiune.
Dacă 3003 este ocupat de alt dashboard, v5 poate fi testat separat:

```bash
G1_DASHBOARD_PORT=3015 bash start_dashboard.sh
```

## Flux de lucru

1. `Pornește cartografierea` și deplasează robotul.
2. Urmărește harta live și starea topicurilor în dreapta.
3. Folosește `Pauză/Continuă`, `Stop` sau scrie numele și apasă `Salvează`.
4. Selectează harta, completează poziția inițială și pornește localizarea 1804.
5. Alege o destinație prin click sau coordonate și trimite API 1102.

Hărțile 3D finale sunt în `maps/*.pcd`, iar variantele 2D folosite de viewer și
A* sunt în `maps/maps_2d/*.pcd`. În timpul cartografierii, câte un PCD 3D
cumulativ este scris la fiecare 5 secunde în
`maps/partial_maps/mapping_YYYYMMDD_HHMMSS/`; perechea sa plană se află în
subfolderul `maps_2d/` al aceleiași sesiuni.

În interfață, secțiunea `Sesiuni cu hărți parțiale` permite vizualizarea și
descărcarea ultimei capturi din sesiunea aleasă. Pe disc se pot inspecta toate
capturile, iar orice fișier PCD poate fi deschis și în CloudCompare sau PCL.

În viewer: rotița face zoom în jurul cursorului, drag deplasează harta,
`+`/`-` schimbă zoomul și `Încadrează` revine la întreaga hartă. Clickul alege
destinația. Yaw-ul final se poate alege din cele patru preseturi sau prin
`Shift+drag`; săgeata roșie arată orientarea care va fi trimisă robotului.
Punctele cyan sunt proiecția XY a hărții 3D deja stabilizate. Browserul nu
transformă scanuri și nu reconstruiește el o hartă pseudo-3D. Butonul
Camera este implicit fixă și se încadrează o singură dată la primul nor nevid.
Robotul se deplasează pe hartă fără să deplaseze camera. `Urmărește robotul`
activează explicit centrarea pe robot; o sesiune nouă revine la camera fixă.
Un drag manual sau `Încadrează` oprește urmărirea.

Navigația are o barieră obligatorie în două etape. `Previzualizează` calculează
local o rută A* peste PCD și nu publică nicio comandă de mers. Backendul emite
un `preview_id` valabil 120 s. Numai `Confirmă și pornește`, fără modificarea
țintei, yaw-ului sau vitezei, poate trimite API 1102. Orice modificare cere o
previzualizare nouă.

După confirmare, ruta A* este simplificată și împărțită în segmente de maximum
0,80 m. Backendul trimite succesiv capătul fiecărui segment prin API 1102 în
modul de ocolire, trecând mai departe numai după ce odometria confirmă atingerea
waypoint-ului. Pierderea localizării sau lipsa progresului timp de 20 s oprește
navigația prin API 1201. Deoarece navigatorul nativ poate reseta profilul de
mers când acceptă un nou 1102, backendul reafirmă RUN prin API 7107 după fiecare
waypoint și după `Continuă`; dacă RUN este refuzat, ruta este pusă în pauză.
`Pauză` și `Continuă` suspendă și reiau același executor.

`Golește doar vizualizarea` scoate harta din canvas, dar nu șterge fișierul PCD
și nu afectează capturile parțiale. Astfel se poate reveni la mapping sau se
poate selecta imediat altă hartă.

Modurile robotului sunt protejate cu parola cerută în interfață. Backendul
verifică parola separat și publică numai prin ROS 2 pe `/api/sport/request`.
Damp și Ready cer FSM 1, respectiv FSM 4. Run face automat tranziția prin
Ready dacă este necesar, selectează controllerul acceptat de firmware
(`7111` + FSM 801/802 sau `7110` + FSM 500/501/502) și citește API 7001 până
când robotul confirmă starea reală, apoi setează profilul RUN prin API 7107
cu valoarea 1. Un simplu ACK la schimbarea FSM-ului nu
mai este afișat drept succes. Schimbarea este una fizică și trebuie confirmată
în dialogul browserului.

Pentru o hartă bună: pornește cu robotul nemișcat, așteaptă apariția cloudului,
mergi lent pe conturul spațiului, evită întoarcerile bruște, revino într-o zonă
deja cunoscută pentru închiderea buclei și salvează numai după ce cloudul și
odometria rămân verzi în interfață.

La salvare, 1802 creează și o copie în filesystemul serviciului SLAM. V5
ține asocierea în `maps/.native_paths.json`, astfel încât 1804 folosește calea
nativă, iar viewerul folosește copia locală.

## Pipeline și topicuri

- puncte pentru hartă: `/utlidar/cloud_livox_mid360` (`PointCloud2`, reliable)
- poziție și orientare pentru acumulare: `/state_estimator/odom_pelvis`
- diagnostic SLAM nativ: `/unitree/slam_mapping/points` și
  `/unitree/slam_mapping/odom`
- localizare: `/unitree/slam_localization/points`,
  `/unitree/slam_relocation/points` și odometriile corespunzătoare
- comenzi/răspunsuri: `/api/slam_operate/request`,
  `/api/slam_operate/response`

LiDARul brut și odometria folosesc abonamente RELIABLE (depth 5), ca
`ros2 topic echo`. Launcherul păstrează configurația CycloneDDS a terminalului;
nu mai impune `/home/unitree/cyclonedds.xml`. Pentru o configurație explicită,
setează `G1_CYCLONEDDS_URI` înainte de pornire.
