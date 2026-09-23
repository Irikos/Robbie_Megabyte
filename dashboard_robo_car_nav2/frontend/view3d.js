"use strict";
// Vizualizare 3D, sincronizată strâns cu harta 2D — ambele sunt afișate
// simultan (panouri separate), arată exact aceleași date, actualizate din
// aceleași surse. Interacțiunea (click pentru destinație, drag pentru
// orientare, TF mașinuță etc.) rămâne exclusiv pe harta 2D (#map),
// neschimbată — acest fișier doar citește ce a fost deja setat acolo
// (poziție, țintă, rută, transformare mașinuță) și desenează același lucru
// în 3D, plus norul complet 3D al hărții curente (din /api/map/points sau
// /api/maps/{nume}/points, deja disponibile în backend).
(() => {
  const canvas3d = document.getElementById("map3d");
  if (!canvas3d || typeof THREE === "undefined") return;

  let renderer, scene, camera, controls;
  let pointsMesh, carPointsMesh, robotGroup, robotFallbackMesh, goalMarker, goalArrow, carMarker, carFallbackMesh, routeLine, carRouteLine, semanticChairGroup;
  let sceneReady = false;
  let carState = {};
  let floorOffset = 0; // ridică norul hărții G1 ca podeaua reală să cadă la y=0

  function worldToThree(x, y) { return { x: Number(x) || 0, z: -(Number(y) || 0) }; }
  function yawToThreeRotation(yaw) { return (Number(yaw) || 0) - Math.PI / 2; }

  // ── Modelul 3D al G1, portat identic din dashboard_g1_test_v2 ────────────
  function makeSolidRobotMaterial(options) {
    return new THREE.MeshStandardMaterial({
      ...options, transparent: false, opacity: 1,
      side: THREE.DoubleSide, depthTest: true, depthWrite: true,
    });
  }

  function buildFallbackG1() {
    const group = new THREE.Group();
    const light = makeSolidRobotMaterial({ color: 0xcbd5e1, roughness: 0.55, metalness: 0.2 });
    const dark = makeSolidRobotMaterial({ color: 0x1f2937, roughness: 0.65, metalness: 0.15 });
    const part = (geometry, material, position, rotation = [0, 0, 0]) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.rotation.set(...rotation);
      group.add(mesh);
    };
    part(new THREE.BoxGeometry(0.34, 0.22, 0.22), dark, [0, 0.72, 0]);
    part(new THREE.BoxGeometry(0.43, 0.43, 0.22), light, [0, 1.01, 0]);
    part(new THREE.SphereGeometry(0.16, 16, 12), dark, [0, 1.34, -0.01]);
    [-0.12, 0.12].forEach((x) => {
      part(new THREE.CapsuleGeometry(0.065, 0.31, 6, 10), light, [x, 0.43, 0]);
      part(new THREE.CapsuleGeometry(0.055, 0.30, 6, 10), dark, [x, 0.13, -0.015]);
      part(new THREE.BoxGeometry(0.13, 0.06, 0.25), dark, [x, 0.015, -0.07]);
    });
    [-0.29, 0.29].forEach((x) => {
      part(new THREE.CapsuleGeometry(0.05, 0.29, 6, 10), light, [x, 0.93, 0], [0, 0, x < 0 ? -0.12 : 0.12]);
      part(new THREE.CapsuleGeometry(0.045, 0.27, 6, 10), dark, [x * 1.08, 0.65, 0]);
    });
    return group;
  }

  function parseBinarySTL(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength < 84) throw new Error("STL incomplet");
    const count = view.getUint32(80, true);
    if (buffer.byteLength < 84 + count * 50) throw new Error("STL binar invalid");
    const positions = new Float32Array(count * 9);
    const normals = new Float32Array(count * 9);
    let offset = 84;
    for (let triangle = 0; triangle < count; triangle += 1, offset += 50) {
      const nx = view.getFloat32(offset, true);
      const ny = view.getFloat32(offset + 4, true);
      const nz = view.getFloat32(offset + 8, true);
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const source = offset + 12 + vertex * 12;
        const target = triangle * 9 + vertex * 3;
        positions[target] = view.getFloat32(source, true);
        positions[target + 1] = view.getFloat32(source + 4, true);
        positions[target + 2] = view.getFloat32(source + 8, true);
        normals[target] = nx; normals[target + 1] = ny; normals[target + 2] = nz;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.computeBoundingSphere();
    return geometry;
  }

  async function loadG1RobotModel() {
    const definitions = [
      ["/static/assets/g1/g1_light.stl", makeSolidRobotMaterial({ color: 0xbfc7ce, roughness: 0.48, metalness: 0.28 })],
      ["/static/assets/g1/g1_dark.stl", makeSolidRobotMaterial({ color: 0x20262d, roughness: 0.62, metalness: 0.18 })],
    ];
    const meshes = await Promise.all(definitions.map(async ([url, material]) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      return new THREE.Mesh(parseBinarySTL(await response.arrayBuffer()), material);
    }));
    const model = new THREE.Group();
    meshes.forEach((mesh) => model.add(mesh));
    robotGroup.add(model);
    if (robotFallbackMesh) robotFallbackMesh.visible = false;
  }

  function loadThreeAsset(loader, url) {
    return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
  }

  async function loadCarModel() {
    if (typeof THREE.OBJLoader !== "function") throw new Error("OBJLoader indisponibil");
    const assetRoot = "/static/assets/car/model_masina";
    const [model, texture] = await Promise.all([
      loadThreeAsset(new THREE.OBJLoader(), `${assetRoot}/3DModel.obj`),
      loadThreeAsset(new THREE.TextureLoader(), `${assetRoot}/3DModel.jpg`),
    ]);
    if ("colorSpace" in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    else if (THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const material = new THREE.MeshStandardMaterial({
      map: texture, color: 0xffffff, roughness: 0.72, metalness: 0.04,
      side: THREE.DoubleSide,
    });
    let meshCount = 0;
    model.traverse((child) => {
      if (!child.isMesh) return;
      child.material = material;
      child.frustumCulled = true;
      meshCount += 1;
    });
    if (!meshCount) throw new Error("OBJ-ul nu conține nicio plasă");

    model.updateMatrixWorld(true);
    let bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const horizontalSize = Math.max(size.x, size.z);
    if (!Number.isFinite(horizontalSize) || horizontalSize <= 0) throw new Error("Dimensiuni OBJ invalide");
    model.scale.setScalar(0.75 / horizontalSize);
    model.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -bounds.min.y, -center.z);

    carMarker.add(model);
    carFallbackMesh.visible = false;
  }

  function initScene() {
    if (sceneReady) return true;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true });
    } catch (error) {
      if (typeof toast === "function") toast(`Vizualizarea 3D nu a putut porni: ${error.message}`, true);
      return false;
    }
    sceneReady = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02050a);
    camera = new THREE.PerspectiveCamera(55, 1, 0.05, 500);
    camera.position.set(0, 9, 11);
    controls = new THREE.OrbitControls(camera, canvas3d);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495;

    scene.add(new THREE.GridHelper(60, 60, 0x24344e, 0x121d31));
    scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const sun = new THREE.DirectionalLight(0xffffff, 0.55);
    sun.position.set(6, 12, 4);
    scene.add(sun);

    pointsMesh = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ size: 0.045, vertexColors: true, sizeAttenuation: true })
    );
    scene.add(pointsMesh);

    carPointsMesh = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: 0xfb923c, size: 0.06, sizeAttenuation: true, transparent: true, opacity: 0.8 })
    );
    scene.add(carPointsMesh);

    semanticChairGroup = new THREE.Group();
    scene.add(semanticChairGroup);

    robotGroup = new THREE.Group();
    robotFallbackMesh = buildFallbackG1();
    robotGroup.add(robotFallbackMesh);
    const headingArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0.95, 0), 1.0, 0xff3b30, 0.28, 0.18
    );
    robotGroup.add(headingArrow);
    robotGroup.visible = false;
    scene.add(robotGroup);
    loadG1RobotModel().catch(() => {
      // Rămâne pe modelul procedural (fallback) dacă STL-urile oficiale nu se încarcă.
    });

    goalMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.14, 0.22, 28),
      new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide })
    );
    goalMarker.rotation.x = -Math.PI / 2;
    goalMarker.visible = false;
    scene.add(goalMarker);

    goalArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.05, 0), 0.7, 0xef4444, 0.2, 0.13
    );
    goalArrow.visible = false;
    scene.add(goalArrow);

    carMarker = new THREE.Group();
    carFallbackMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.14, 0.48),
      new THREE.MeshBasicMaterial({ color: 0xfb923c })
    );
    carFallbackMesh.position.y = 0.07;
    carMarker.add(carFallbackMesh);
    carMarker.visible = false;
    scene.add(carMarker);
    loadCarModel().catch((error) => {
      console.warn("Modelul 3D al mașinii nu s-a încărcat; folosesc fallback-ul.", error);
    });

    routeLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xfff200, linewidth: 6 })
    );
    routeLine.visible = false;
    scene.add(routeLine);

    carRouteLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xfbbf24 })
    );
    carRouteLine.visible = false;
    scene.add(carRouteLine);

    window.addEventListener("resize", resizeRenderer);
    resizeRenderer();
    requestAnimationFrame(animate);
    return true;
  }

  function resizeRenderer() {
    if (!renderer) return;
    const rect = canvas3d.getBoundingClientRect();
    const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function animate() {
    requestAnimationFrame(animate);
    if (!renderer) return;
    controls.update();
    updateLiveMarkers();
    renderer.render(scene, camera);
  }

  function heightColor(z) {
    const t = Math.max(0, Math.min(1, (Number(z) + 0.3) / 2.2));
    return [0.16 + 0.55 * t, 0.55 + 0.22 * t, 0.86 - 0.38 * t];
  }

  // Norul brut are Z relativ la originea senzorului (LiDAR-ul e sus, pe cap),
  // nu la podea. Al 5-lea percentil e o estimare robustă a podelei (ignoră
  // câțiva outlieri joși), pe care o aducem la y=0, unde stau și robotul și
  // grila de referință.
  function estimateFloorOffset(points) {
    if (!points.length) return 0;
    const heights = points.map((p) => Number(p[2]) || 0).sort((a, b) => a - b);
    const floor = heights[Math.floor(heights.length * 0.05)];
    return -floor;
  }

  function fillGeometry(mesh, points, colorFn, heightOffset = 0) {
    const count = points.length;
    const positions = new Float32Array(count * 3);
    const colors = colorFn ? new Float32Array(count * 3) : null;
    for (let i = 0; i < count; i += 1) {
      const p = points[i];
      const flat = worldToThree(p[0], p[1]);
      const height = (Number(p[2]) || 0) + heightOffset;
      positions[i * 3] = flat.x;
      positions[i * 3 + 1] = height;
      positions[i * 3 + 2] = flat.z;
      if (colorFn) {
        const c = colorFn(height);
        colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
      }
    }
    mesh.geometry.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    if (colorFn) geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    mesh.geometry = geometry;
  }

  function setLine(line, points2d, y) {
    if (!points2d || points2d.length < 2) { line.visible = false; return; }
    const positions = new Float32Array(points2d.length * 3);
    points2d.forEach((p, i) => {
      const flat = worldToThree(Number(p[0]), Number(p[1]));
      positions[i * 3] = flat.x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = flat.z;
    });
    line.geometry.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    line.geometry = geometry;
    line.visible = true;
  }

  let lastLoadedMapName; // nedefinit = nu s-a încărcat încă nimic
  async function loadMapPoints() {
    const select = document.getElementById("maps");
    const name = select ? select.value : "";
    const isLive = !name;
    // O hartă salvată e statică — nu o recitim de pe disc la fiecare tick,
    // doar când selecția chiar se schimbă. Harta live (fără hartă selectată)
    // se poate schimba cât timp se cartografiază, deci se reactualizează
    // periodic — la fel ca norul 2D, din aceeași sursă de date.
    if (!isLive && name === lastLoadedMapName) return;
    try {
      const data = isLive
        ? await api("/api/map/points?limit=45000")
        : await api(`/api/maps/${encodeURIComponent(name)}/points?limit=100000`);
      const points = data.points || [];
      floorOffset = estimateFloorOffset(points);
      const FLOOR_CUTOFF = 0.22; // metri deasupra podelei; mărește ca să ascunzi mai mult
      const faraPodea = points.filter(p => ((Number(p[2]) || 0) + floorOffset) >= FLOOR_CUTOFF);
      fillGeometry(pointsMesh, faraPodea, heightColor, floorOffset);
      lastLoadedMapName = name;
    } catch (_error) {
      // Doar vizualizare — o eroare aici nu trebuie să afecteze controlul 2D.
    }
  }

  async function loadCarPoints() {
    try {
      carState = await api("/api/car/status?include_layers=true");
      const points = (carState.map_points || []).map((p) => [p.x, p.y, 0]);
      fillGeometry(carPointsMesh, points, null);
      const showMap = document.getElementById("car-show-map");
      carPointsMesh.visible = points.length > 0 && (!showMap || showMap.checked);
    } catch (_error) {
      // idem — mașinuța poate fi deconectată, nu e o eroare a vizualizării.
    }
  }

  function updateLiveMarkers() {
    if (typeof state !== "undefined" && state && state.pose) {
      const flat = worldToThree(state.pose.x, state.pose.y);
      robotGroup.position.set(flat.x, 0, flat.z);
      robotGroup.rotation.y = yawToThreeRotation(state.pose.yaw);
      robotGroup.visible = true;
    } else {
      robotGroup.visible = false;
    }

    const goal = typeof window.getG1Goal === "function" ? window.getG1Goal() : null;
    if (goal) {
      const flat = worldToThree(goal.x, goal.y);
      goalMarker.position.set(flat.x, 0.02, flat.z);
      goalMarker.visible = true;
      goalArrow.position.set(flat.x, 0.05, flat.z);
      goalArrow.setDirection(new THREE.Vector3(Math.cos(goal.yaw), 0, -Math.sin(goal.yaw)));
      goalArrow.visible = true;
    } else {
      goalMarker.visible = false;
      goalArrow.visible = false;
    }

    const preview = typeof routePreview !== "undefined" ? routePreview : null;
    routeLine.material.color.set(0xfff200);
    routeLine.material.opacity = 1.0;
    routeLine.material.transparent = true;
    setLine(routeLine, preview && preview.points, 0.05);

    if (carState && carState.pose && carState.connected) {
      const flat = worldToThree(carState.pose.x, carState.pose.y);
      carMarker.position.set(flat.x, 0.02, flat.z);
      carMarker.rotation.y = yawToThreeRotation(carState.pose.yaw);
      carMarker.visible = true;
    } else {
      carMarker.visible = false;
    }
    const carPath = (carState.path || []).map((p) => [p.x, p.y]);
    setLine(carRouteLine, carPath, 0.06);
  }



  function semanticAgingColor(agingValue, agingCap) {
    const ratio = Math.max(0, Math.min(1, agingValue / Math.max(0.1, agingCap)));
    return ratio > 0.50 ? "#c084fc" : ratio > 0.25 ? "#f59e0b" : "#ef4444";
  }

  function semanticLabelSprite(text, agingValue = 0, agingCap = 100, lidarSupported = false) {
    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 512;
    labelCanvas.height = 96;
    const context = labelCanvas.getContext("2d");
    const value = Math.max(0, Number(agingValue) || 0);
    const cap = Math.max(1, Number(agingCap) || 100);
    const ratio = Math.max(0, Math.min(1, value / cap));
    const color = semanticAgingColor(value, cap);
    context.fillStyle = "rgba(15,5,30,.94)";
    context.strokeStyle = color;
    context.lineWidth = 5;
    context.fillRect(4, 4, 504, 88);
    context.strokeRect(4, 4, 504, 88);
    context.fillStyle = "#fff";
    context.font = "bold 30px Inter, sans-serif";
    context.textBaseline = "middle";
    context.fillText(text, 18, 34);
    context.fillStyle = color;
    context.font = "bold 24px ui-monospace, monospace";
    context.textAlign = "right";
    context.fillText(`AGING ${value.toFixed(0)}/${cap.toFixed(0)}`, 494, 34);
    context.fillStyle = "rgba(255,255,255,.16)";
    context.fillRect(18, 70, 476, 14);
    context.fillStyle = color;
    context.fillRect(18, 70, 476 * ratio, 14);
    context.fillStyle = lidarSupported ? "#22d3ee" : "#94a3b8";
    context.font = "bold 15px Inter, sans-serif";
    context.fillText(lidarSupported ? "LiDAR ✓" : "YOLO/cameră", 492, 59);
    const texture = new THREE.CanvasTexture(labelCanvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(1.55, 0.29, 1);
    sprite.renderOrder = 20;
    return sprite;
  }

  function clearSemanticChairScene() {
    if (!semanticChairGroup) return;
    semanticChairGroup.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach((material) => {
        if (material.map) material.map.dispose();
        material.dispose();
      });
    });
    semanticChairGroup.clear();
  }

  function renderSemanticChairs(message) {
    if (!sceneReady || !semanticChairGroup) return;
    clearSemanticChairScene();
    if (!message?.calibration_available) return;
    const objects = Array.isArray(message.objects) ? message.objects : [];
    const defaultCap = Math.max(1, Number(message.aging_cap) || 100);
    objects.forEach((object) => {
      const points = Array.isArray(object.points) ? object.points : [];
      if (points.length) {
        const positions = new Float32Array(points.length * 3);
        const colors = new Float32Array(points.length * 3);
        points.forEach((point, index) => {
          const flat = worldToThree(point.x, point.y);
          positions[index * 3] = flat.x;
          positions[index * 3 + 1] = Number(point.z) || 0;
          positions[index * 3 + 2] = flat.z;
          colors[index * 3] = Number(point.r ?? 180) / 255;
          colors[index * 3 + 1] = Number(point.g ?? 180) / 255;
          colors[index * 3 + 2] = Number(point.b ?? 180) / 255;
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        semanticChairGroup.add(new THREE.Points(geometry, new THREE.PointsMaterial({
          size: 0.028, vertexColors: true, sizeAttenuation: true,
          transparent: true, opacity: 0.9,
        })));
      }
      const minimum = object.bounds?.min;
      const maximum = object.bounds?.max;
      if (!minimum || !maximum) return;
      const sizeX = Math.max(0.08, Number(maximum.x) - Number(minimum.x));
      const sizeY = Math.max(0.08, Number(maximum.y) - Number(minimum.y));
      const sizeZ = Math.max(0.08, Number(maximum.z) - Number(minimum.z));
      const center = worldToThree(
        (Number(minimum.x) + Number(maximum.x)) / 2,
        (Number(minimum.y) + Number(maximum.y)) / 2,
      );
      const centerZ = (Number(minimum.z) + Number(maximum.z)) / 2;
      const aging = Math.max(0, Number(object.aging_value) || 0);
      const cap = Math.max(1, Number(object.aging_cap) || defaultCap);
      const boxGeometry = new THREE.BoxGeometry(sizeX, sizeZ, sizeY);
      const volume = new THREE.Mesh(boxGeometry, new THREE.MeshBasicMaterial({
        color: 0xa855f7, transparent: true, opacity: 0.06,
        depthWrite: false, side: THREE.DoubleSide,
      }));
      volume.position.set(center.x, centerZ, center.z);
      semanticChairGroup.add(volume);
      const edgesSource = boxGeometry.clone();
      const edgesGeometry = new THREE.EdgesGeometry(edgesSource);
      edgesSource.dispose();
      const box = new THREE.LineSegments(
        edgesGeometry,
        new THREE.LineBasicMaterial({ color: semanticAgingColor(aging, cap) }),
      );
      box.position.copy(volume.position);
      semanticChairGroup.add(box);
      const label = semanticLabelSprite(
        object.name || `chair ${object.id}`, aging, cap, Boolean(object.lidar_supported),
      );
      label.position.set(center.x, Number(maximum.z) + 0.18, center.z);
      semanticChairGroup.add(label);
    });
  }


  function refreshAll() {
    loadMapPoints();
    loadCarPoints();
  }

  window.addEventListener("semantic-chairs", (event) => renderSemanticChairs(event.detail));
  window.renderSemanticChairs = renderSemanticChairs;

  const mapsSelect = document.getElementById("maps");
  if (mapsSelect) mapsSelect.addEventListener("change", refreshAll);

  // ── Comutare panouri: 3D, 2D sau ambele — doar afișare, controlul rămâne
  // mereu pe #map (2D), indiferent care panou e vizibil în acel moment.
  const pane3d = document.querySelector(".viewer-pane-3d");
  const pane2d = document.querySelector(".viewer-pane-2d");
  const modeButtons = document.querySelectorAll("[data-view-mode]");
  function setViewMode(mode) {
    if (pane3d) pane3d.classList.toggle("pane-hidden", mode === "2d");
    if (pane2d) pane2d.classList.toggle("pane-hidden", mode === "3d");
    modeButtons.forEach((button) => {
      const isActive = button.dataset.viewMode === mode;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    if (mode !== "2d") requestAnimationFrame(resizeRenderer);
    if (mode !== "3d" && typeof requestDraw === "function") requestAnimationFrame(requestDraw);
  }
  modeButtons.forEach((button) => {
    button.addEventListener("click", () => setViewMode(button.dataset.viewMode));
  });

  if (initScene()) {
    if (window.latestSemanticChairMessage) renderSemanticChairs(window.latestSemanticChairMessage);
    refreshAll();
    setInterval(loadCarPoints, 1000);
    setInterval(loadMapPoints, 3000);
  }
})();
