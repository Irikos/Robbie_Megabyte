# Pornire dashboard_slam_nav2

```bash
cd /home/unitree/robot_car/dashboard_slam_nav2
./start_dashboard.sh
```

Dashboard: port 3003. Receptor RealSense: port 5005.

## Corecția pornirii din 17 septembrie 2026

- `config/cyclonedds.xml` se aplică numai proceselor lansate de script.
  ParticipantIndex auto poate căuta indicii 0–99, în locul limitei implicite
  0–9 a bibliotecii Humble instalate. Domeniul și fișierele DDS globale nu
  sunt modificate. Interfețele și peer-urile sunt cele ale acestui robot.
- Backendul nu mai inițializează `unitree_sdk2py`/CycloneDDS Python la import.
  ROS 2 este inițializat o singură dată, înaintea threadurilor. SportClient
  folosește publisherul `/api/sport/request` al motorului Nav2; gesturile
  folosesc `/api/arm/request`. Inițializarea nu schimbă FSM și nu pornește
  mișcarea. Numele istorice `sdk_available` din UI sunt păstrate compatibile.
- Camera pornește după ce endpointul autentificat `/api/health/startup`
  confirmă inițializarea ROS și listenerul TCP 5005. Acest health check nu
  înseamnă că harta/localizarea/scanul sunt pregătite pentru navigație.
- Fiecare proces gestionat are propriul grup. Ieșirea unui nod Nav2 închide
  bringupul; ieșirea unui copil gestionat închide întreaga instanță. Cleanupul
  oprește și descendenții, astfel încât nu rămân noduri Nav2 orfane.
- Lockul este local (`.dashboard.lock`), fără lockul copiat de la altă versiune.

Nu porni simultan alt stack Nav2 în același domeniu. După pornire, încarcă
harta și verifică localizarea și senzorii din preflight înainte de navigație.
Nu folosi `--repair-native-slam` pentru o eroare DDS sau camera indisponibilă:
este o operație de mentenanță separată, care modifică serviciile native.

## Teste fără robot

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -q backend/tests
bash -n start_dashboard.sh
```

Autoloadul pluginurilor pytest este dezactivat numai pentru comandă: pluginul
ROS `launch_testing` instalat nu este compatibil cu versiunea locală pytest.
Testele transportului folosesc noduri simulate și nu trimit comenzi robotului.
