"use strict";

const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(window.location.search);
const suppliedToken = query.get("token");
if (suppliedToken) sessionStorage.setItem("robot_car_nav2_token", suppliedToken);
const token = suppliedToken || sessionStorage.getItem("robot_car_nav2_token") || "";

let state = null;
let mapPoints = [];
let goal = null;
let routePreview = null;
let bounds = { minX: -5, maxX: 5, minY: -5, maxY: 5 };
let lastRevision = -1;
let viewingStoredMap = false;
let firstMapFrame = true;
let toastTimer = null;
let backendOnline = false;
let pointerInteraction = null;
let followRobot = false;
let stateRefreshRunning = false;
let teleopPendingKey = null;
let teleopKeySending = false;
const heldTeleopKeys = new Map();
let activeTeleopKey = null;

const canvas = $("map");
const ctx = canvas.getContext("2d", { alpha: true });

function radians(degreesValue) {
  return Number(degreesValue || 0) * Math.PI / 180;
}

function degrees(radiansValue) {
  return Number(radiansValue || 0) * 180 / Math.PI;
}

function toast(message, error = false) {
  const box = $("toast");
  box.textContent = message;
  box.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.className = "toast"; }, 4200);
}

function log(message) {
  const clock = new Date().toLocaleTimeString("ro-RO", { hour12: false });
  const area = $("log");
  area.textContent = `[${clock}] ${message}\n${area.textContent}`.slice(0, 10000);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers["X-Dashboard-Token"] = token;
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { ...options, headers, cache: "no-store" });
  let body;
  try {
    body = await response.json();
  } catch (_error) {
    throw new Error(`Răspuns HTTP invalid (${response.status})`);
  }
  if (!response.ok) throw new Error(body.detail || body.error || `HTTP ${response.status}`);
  return body;
}

function setText(id, value) {
  $(id).textContent = value;
}

function invalidateRoute(message = "Ruta nu a fost calculată") {
  routePreview = null;
  $("navigate").disabled = true;
  $("route-summary").className = "route-summary";
  setText("route-summary", message);
  draw();
}

function ageLabel(age) {
  if (age === null || age === undefined) return "Fără date";
  if (age < 0.15) return "live · acum";
  if (age < 10) return `acum ${age.toFixed(1)} s`;
  return `vechi · ${Math.round(age)} s`;
}

function velocityLabel(values, age) {
  if (!Array.isArray(values) || values.length < 3) return "—";
  const vector = values.slice(0, 3).map(Number);
  if (!vector.every(Number.isFinite)) return "date invalide";
  const ageValue = Number(age);
  const suffix = age !== null && age !== undefined && Number.isFinite(ageValue)
    ? ` · ${ageValue.toFixed(2)}s`
    : "";
  return `[${vector.map((value) => value.toFixed(2)).join(", ")}]${suffix}`;
}

function yawDiagnosticLabel(diagnostic) {
  const present = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
  if (![diagnostic?.goal, diagnostic?.map_to_base_link, diagnostic?.goal_error].every(present)) return "—";
  const goalYaw = Number(diagnostic.goal);
  const mapYaw = Number(diagnostic.map_to_base_link);
  const error = Number(diagnostic.goal_error);
  const odom = present(diagnostic?.odom_to_base_link)
    ? ` · odom ${degrees(Number(diagnostic.odom_to_base_link)).toFixed(1)}°`
    : "";
  return `g ${degrees(goalYaw).toFixed(1)}° · map ${degrees(mapYaw).toFixed(1)}°${odom} · Δ ${degrees(error).toFixed(1)}°`;
}

function setHealth(id, age) {
  const dot = $(id);
  dot.className = "status-dot";
  dot.classList.add(age === null || age === undefined || age > 3 ? "bad" : age > 1.5 ? "warn" : "good");
}

function updateFollowButton() {
  const button = $("follow-robot");
  button.classList.toggle("active", followRobot);
  button.textContent = followRobot ? "Urmărire activă" : "Urmărește robotul";
  button.setAttribute("aria-pressed", String(followRobot));
}

function centerOnRobot() {
  if (!state || !state.pose) return;
  const rect = canvas.getBoundingClientRect();
  const visibleBounds = boundsForViewport(rect.width, rect.height);
  const spanX = Math.max(10, visibleBounds.maxX - visibleBounds.minX);
  const spanY = Math.max(10, visibleBounds.maxY - visibleBounds.minY);
  const x = Number(state.pose.x || 0);
  const y = Number(state.pose.y || 0);
  bounds = {
    minX: x - spanX / 2,
    maxX: x + spanX / 2,
    minY: y - spanY / 2,
    maxY: y + spanY / 2,
  };
}

async function refreshState() {
  if (stateRefreshRunning) return;
  stateRefreshRunning = true;
  try {
    const next = await api("/api/status");
    state = next;
    const justReconnected = !backendOnline;
    backendOnline = true;
    setText("connection", "Backend conectat");
    const odomAge = next.base_odom_age;
    const source = next.localization_input || "topicuri ROS 2";
    setText("connection-detail", `${source} · ${next.pose_source || "în așteptare"}`);
    $("connection-dot").className = "status-dot good";

    const mode = next.mode || "idle";
    setText("mode-pill", mode);
    $("mode-pill").className = `mode-pill ${mode}`;
    const mappingActive = mode === "mapping";
    $("start-map").disabled = mappingActive;
    $("pause-map").disabled = !mappingActive;
    $("stop-map").disabled = !mappingActive;
    $("save-map").disabled = !mappingActive;
    $("pause-map").textContent = next.mapping_paused ? "▶ Continuă" : "Ⅱ Pauză";
    setText("rmw", next.rmw === "rmw_cyclonedds_cpp" ? "CycloneDDS" : (next.rmw || "RMW necunoscut"));
    const locomotion = next.locomotion_bridge || {};
    const navigation = next.navigation || {};
    setText("diag-nav2", velocityLabel(navigation.nav2_velocity, navigation.nav2_cmd_age));
    setText("diag-raw", velocityLabel(navigation.raw_velocity, navigation.raw_cmd_age));
    setText("diag-smoothed", velocityLabel(navigation.smoothed_velocity, navigation.smoothed_cmd_age));
    setText("diag-safe", velocityLabel(navigation.safe_velocity, navigation.safe_cmd_age));
    setText("diag-sport", velocityLabel(locomotion.last_velocity, locomotion.last_command_age));
    setText("diag-yaw", yawDiagnosticLabel(next.yaw_diagnostics));
    const reportedTeleopSpeed = Number(locomotion.teleop_speed);
    if (Number.isFinite(reportedTeleopSpeed) && document.activeElement !== $("teleop-speed")) {
      $("teleop-speed").value = reportedTeleopSpeed.toFixed(2);
      setText("teleop-speed-value", `${reportedTeleopSpeed.toFixed(2)} m/s`);
    }
    const reportedTeleopTurnSpeed = Number(locomotion.teleop_turn_speed);
    if (Number.isFinite(reportedTeleopTurnSpeed) && document.activeElement !== $("teleop-turn-speed")) {
      $("teleop-turn-speed").value = reportedTeleopTurnSpeed.toFixed(2);
      setText("teleop-turn-speed-value", `${reportedTeleopTurnSpeed.toFixed(2)} rad/s`);
    }
    const teleopCapture = $("teleop-capture");
    teleopCapture.classList.toggle("active", Boolean(locomotion.teleop_enabled));
    teleopCapture.setAttribute("aria-disabled", String(!locomotion.teleop_enabled));
    setText("robot-mode-state", `FSM: ${next.robot_fsm ?? "necunoscut"} · serviciu: ${next.motion_service || "necunoscut"} · RUN solicitat: ${next.run_profile_accepted ? "acceptat" : "neconfirmat"}`);
    const teleopState = $("teleop-state");
    if (locomotion.teleop_error) {
      teleopState.className = "readiness warn";
      teleopState.textContent = `Teleop oprit · ${locomotion.teleop_error}`;
    } else if (locomotion.teleop_enabled) {
      teleopState.className = locomotion.teleop_verified ? "readiness good" : "readiness warn";
      teleopState.textContent = locomotion.teleop_verified
        ? "Teleop armat · mișcare confirmată în odometrie"
        : locomotion.teleop_process_running
          ? "Teleop armat · pagina ascultă tastele"
          : "Teleop armat · procesul de tastatură nu rulează";
    } else if (locomotion.teleop_verified) {
      teleopState.className = "readiness good";
      teleopState.textContent = "Teleop dezarmat · proba de locomoție este validă pentru Nav2";
    } else {
      teleopState.className = "readiness neutral";
      teleopState.textContent = "Teleop dezarmat · probă de mers neefectuată";
    }
    const requestedMotion = (navigation.teleop_velocity || []).some((value) => Math.abs(Number(value)) > 0.001);
    const forwardedMotion = (locomotion.last_velocity || []).some((value) => Math.abs(Number(value)) > 0.001);
    if (locomotion.teleop_enabled && locomotion.teleop_last_key_age !== null && locomotion.teleop_last_key_age < 2 && requestedMotion && forwardedMotion && locomotion.last_ack) {
      setText("teleop-key-state", `Tasta ${JSON.stringify(locomotion.teleop_last_key)} a ajuns · API 7105 acceptat`);
    } else if (locomotion.teleop_enabled && locomotion.teleop_last_key_age !== null && locomotion.teleop_last_key_age < 2 && requestedMotion) {
      setText("teleop-key-state", `Tasta ${JSON.stringify(locomotion.teleop_last_key)} a ajuns · cmd_vel primit, aștept API 7105`);
    } else if (locomotion.teleop_enabled && locomotion.teleop_last_key_age !== null && locomotion.teleop_last_key_age < 2) {
      setText("teleop-key-state", `Backend: tasta ${JSON.stringify(locomotion.teleop_last_key)} primită`);
    } else if (locomotion.teleop_enabled) {
      setText("teleop-key-state", "Focus activ · apasă săgețile sau WASD");
    } else {
      setText("teleop-key-state", "Activează teleop pentru control");
    }

    const pose = next.pose || { x: 0, y: 0, yaw: 0 };
    setText("pose-x", Number(pose.x || 0).toFixed(2));
    setText("pose-y", Number(pose.y || 0).toFixed(2));
    setText("pose-yaw", `${degrees(pose.yaw).toFixed(1)}°`);
    setText("cloud", next.mapping_paused ? "Pauză" : ageLabel(next.scan2d_age));
    setText("odom", ageLabel(odomAge));
    setText("lidar", ageLabel(next.lidar_age));
    setText("points", Number(next.scan2d_point_count || 0).toLocaleString("ro-RO"));
    if (["previewed", "starting", "navigating", "orienting", "paused", "blocked", "completed", "failed", "cancelled"].includes(navigation.state)) {
      const progress = navigation.waypoints
        ? ` · waypoint ${navigation.waypoint || 0}/${navigation.waypoints}`
        : "";
      const remaining = navigation.remaining !== null && navigation.remaining !== undefined
        && Number.isFinite(Number(navigation.remaining))
        ? ` · ${Number(navigation.remaining).toFixed(2)} m până la punct`
        : "";
      const smoothStop = navigation.smooth_stop_active
        ? " · decelerare controlată pentru replanificare"
        : "";
      $("route-summary").className = `route-summary${navigation.state === "failed" ? "" : " ready"}`;
      setText("route-summary", `${navigation.message || navigation.state}${progress}${remaining}${smoothStop}`);
      if (["starting", "navigating", "orienting", "paused", "completed"].includes(navigation.state)) {
        $("navigate").disabled = true;
      }
    }
    if (next.mapping_paused) {
      $("cloud-dot").className = "status-dot warn";
    } else {
      setHealth("cloud-dot", next.scan2d_age);
    }
    setHealth("odom-dot", odomAge);
    setHealth("lidar-dot", next.lidar_age);

    setText("session-name", next.session || "—");
    setText("snapshots", next.snapshots || 0);
    setText("last-snapshot", next.last_snapshot || "—");
    setText("snapshot-state", next.snapshot_error ? "Eroare" : next.last_snapshot ? "Salvat la 5 s" : "În așteptare");

    if (justReconnected) await refreshMaps();

    if (!viewingStoredMap && next.scan2d_revision !== lastRevision) {
      lastRevision = next.scan2d_revision;
      await refreshLivePoints();
    } else {
      draw();
    }
  } catch (error) {
    backendOnline = false;
    setText("connection", "Backend indisponibil");
    setText("connection-detail", error.message);
    $("connection-dot").className = "status-dot bad";
  } finally {
    stateRefreshRunning = false;
  }
}

function fitBounds(points) {
  if (!points.length) {
    bounds = { minX: -5, maxX: 5, minY: -5, maxY: 5 };
    return;
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
  }
  const spanX = Math.max(maxX - minX, 2);
  const spanY = Math.max(maxY - minY, 2);
  const padding = Math.max(spanX, spanY) * 0.08 + 0.35;
  bounds = { minX: minX - padding, maxX: maxX + padding, minY: minY - padding, maxY: maxY + padding };
}

function setPoints(points, shouldFit = false) {
  mapPoints = (Array.isArray(points) ? points : [])
    .map((raw) => [Number(raw[0]), Number(raw[1]), 0.5])
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  // Încadrare o singură dată, după primul nor nevid.
  if (mapPoints.length && (shouldFit || firstMapFrame)) fitBounds(mapPoints);
  if (followRobot && state && state.mode === "mapping") centerOnRobot();
  if (mapPoints.length) firstMapFrame = false;
  setText("render-count", mapPoints.length.toLocaleString("ro-RO") + " puncte 2D");
  $("empty-map").classList.toggle("hidden", mapPoints.length > 0);
  draw();
}

async function refreshLivePoints() {
  const data = await api("/api/map/scan2d?limit=30000");
  setPoints(data.points, firstMapFrame);
  const source = state && state.mapping_backend === "native_slam"
    ? "Harta 3D stabilizată, proiectată în XY"
    : "Aștept Mid360 + odometrie";
  setText("viewer-subtitle", `${source} · ${Number(data.total).toLocaleString("ro-RO")} celule`);
}

async function viewSavedMap() {
  const name = $("maps").value;
  if (!name) throw new Error("Selectează mai întâi o hartă");
  const data = await api(`/api/maps/${encodeURIComponent(name)}/scan2d?limit=70000`);
  viewingStoredMap = true;
  firstMapFrame = true;
  setPoints(data.points, true);
  setText("viewer-subtitle", `${data.name} · hartă 2D · ${Number(data.total).toLocaleString("ro-RO")} celule`);
  return data;
}

async function latestPartial() {
  const session = $("partial-sessions").value;
  if (!session) throw new Error("Selectează mai întâi o sesiune parțială");
  const listing = await api(`/api/partial-maps/${encodeURIComponent(session)}`);
  const snapshots = listing.snapshots || [];
  if (!snapshots.length) throw new Error("Sesiunea nu conține încă nicio captură PCD");
  return { session, snapshot: snapshots[snapshots.length - 1] };
}

async function viewLatestPartial() {
  const latest = await latestPartial();
  const data = await api(`/api/partial-maps/${encodeURIComponent(latest.session)}/${encodeURIComponent(latest.snapshot.name)}/scan2d?limit=70000`);
  viewingStoredMap = true;
  firstMapFrame = true;
  setPoints(data.points, true);
  setText("viewer-subtitle", `${data.session} · ${data.name}.pcd · ${Number(data.total).toLocaleString("ro-RO")} puncte`);
  return { success: true, message: `Captura ${data.name} este afișată` };
}

function viewport() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height };
}

function boundsForViewport(width, height, source = bounds) {
  const usableWidth = Math.max(1, width - 70);
  const usableHeight = Math.max(1, height - 70);
  const targetAspect = usableWidth / usableHeight;
  const centerX = (source.minX + source.maxX) / 2;
  const centerY = (source.minY + source.maxY) / 2;
  let spanX = Math.max(0.1, source.maxX - source.minX);
  let spanY = Math.max(0.1, source.maxY - source.minY);
  if (spanX / spanY < targetAspect) {
    spanX = spanY * targetAspect;
  } else {
    spanY = spanX / targetAspect;
  }
  return {
    minX: centerX - spanX / 2,
    maxX: centerX + spanX / 2,
    minY: centerY - spanY / 2,
    maxY: centerY + spanY / 2,
  };
}

function projection(width, height) {
  const visibleBounds = boundsForViewport(width, height);
  const spanX = visibleBounds.maxX - visibleBounds.minX;
  const spanY = visibleBounds.maxY - visibleBounds.minY;
  const usableWidth = Math.max(1, width - 70);
  const usableHeight = Math.max(1, height - 70);
  const scale = Math.min(usableWidth / spanX, usableHeight / spanY);
  const offsetX = (width - spanX * scale) / 2 - visibleBounds.minX * scale;
  const offsetY = (height - spanY * scale) / 2 + visibleBounds.maxY * scale;
  return {
    scale,
    bounds: visibleBounds,
    point: (x, y) => [offsetX + x * scale, offsetY - y * scale],
    world: (px, py) => [(px - offsetX) / scale, (offsetY - py) / scale],
  };
}

function zoomAt(factor, pixelX, pixelY) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const view = projection(width, height);
  const px = pixelX === undefined ? width / 2 : pixelX;
  const py = pixelY === undefined ? height / 2 : pixelY;
  const anchor = view.world(px, py);
  const spanX = view.bounds.maxX - view.bounds.minX;
  const spanY = view.bounds.maxY - view.bounds.minY;
  const requested = Math.max(0.04, Math.min(25, factor));
  const targetSpan = Math.max(spanX, spanY) * requested;
  if (targetSpan < 0.5 || targetSpan > 500) return;
  const ratioX = (anchor[0] - view.bounds.minX) / spanX;
  const ratioY = (anchor[1] - view.bounds.minY) / spanY;
  const nextSpanX = spanX * requested;
  const nextSpanY = spanY * requested;
  bounds = {
    minX: anchor[0] - ratioX * nextSpanX,
    maxX: anchor[0] + (1 - ratioX) * nextSpanX,
    minY: anchor[1] - ratioY * nextSpanY,
    maxY: anchor[1] + (1 - ratioY) * nextSpanY,
  };
  draw();
}

window.centerOnBounds = function(nextBounds) {
  if (!nextBounds) return;
  bounds = { ...nextBounds };
  draw();
};

function setGoalAt(clientX, clientY) {
  if (window.robotCarPick && window.robotCarPick(clientX, clientY)) return;
  invalidateRoute("Destinația s-a schimbat; recalculează ruta");
  const rect = canvas.getBoundingClientRect();
  const view = projection(rect.width, rect.height);
  const world = view.world(clientX - rect.left, clientY - rect.top);
  const yaw = radians($("goal-yaw").value);
  goal = { x: world[0], y: world[1], yaw };
  $("goal-x").value = world[0].toFixed(2);
  $("goal-y").value = world[1].toFixed(2);
  draw();
  toast(`Destinație selectată: X ${world[0].toFixed(2)}, Y ${world[1].toFixed(2)}, yaw ${degrees(yaw).toFixed(0)}°`);
}

function niceStep(span) {
  const rough = span / 10;
  const power = 10 ** Math.floor(Math.log10(Math.max(rough, 0.001)));
  const ratio = rough / power;
  return (ratio >= 5 ? 5 : ratio >= 2 ? 2 : 1) * power;
}

function draw() {
  const { width, height } = viewport();
  ctx.clearRect(0, 0, width, height);
  const view = projection(width, height);
  const visibleBounds = view.bounds;
  const step = niceStep(Math.max(
    visibleBounds.maxX - visibleBounds.minX,
    visibleBounds.maxY - visibleBounds.minY,
  ));

  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(104, 133, 171, .11)";
  ctx.fillStyle = "rgba(131, 150, 178, .46)";
  ctx.font = "9px ui-monospace, monospace";
  for (let x = Math.ceil(visibleBounds.minX / step) * step; x <= visibleBounds.maxX + step * .01; x += step) {
    const [px] = view.point(x, 0);
    ctx.strokeStyle = Math.abs(x) < step * 0.01 ? "rgba(239,89,103,.30)" : "rgba(104,133,171,.11)";
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, height); ctx.stroke();
    if (px > 4 && px < width - 28) ctx.fillText(`${Number(x.toFixed(2))}m`, px + 3, height - 8);
  }
  for (let y = Math.ceil(visibleBounds.minY / step) * step; y <= visibleBounds.maxY + step * .01; y += step) {
    const [, py] = view.point(0, y);
    ctx.strokeStyle = Math.abs(y) < step * 0.01 ? "rgba(83,214,139,.30)" : "rgba(104,133,171,.11)";
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(width, py); ctx.stroke();
    if (py > 12 && py < height - 4) ctx.fillText(`${Number(y.toFixed(2))}m`, 7, py - 4);
  }

  // Proiecția XY vine din harta 3D stabilizată; browserul doar o desenează.
  if (window.drawRobotCarLayers) window.drawRobotCarLayers(ctx, view);
  const pointSize = 2;
  const screenCell = 1.35;
  const visible = new Map();
  for (const point of mapPoints) {
    if (point[0] < visibleBounds.minX || point[0] > visibleBounds.maxX || point[1] < visibleBounds.minY || point[1] > visibleBounds.maxY) continue;
    const projected = view.point(point[0], point[1]);
    const key = Math.floor(projected[0] / screenCell) + ":" + Math.floor(projected[1] / screenCell);
    if (!visible.has(key)) visible.set(key, projected);
  }

  ctx.save();
  ctx.fillStyle = "rgba(83, 218, 245, .92)";
  ctx.shadowColor = "rgba(34, 211, 238, .32)";
  ctx.shadowBlur = 2;
  for (const point of visible.values()) {
    ctx.fillRect(point[0] - pointSize / 2, point[1] - pointSize / 2, pointSize, pointSize);
  }
  ctx.restore();

  if (routePreview && routePreview.points.length > 1) {
    ctx.save();
    ctx.strokeStyle = "#a78bfa";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    routePreview.points.forEach((point, index) => {
      const projected = view.point(Number(point[0]), Number(point[1]));
      if (index === 0) ctx.moveTo(projected[0], projected[1]);
      else ctx.lineTo(projected[0], projected[1]);
    });
    ctx.stroke();
    ctx.restore();
  }

  if (state && state.pose) {
    const pose = state.pose;
    const [rx, ry] = view.point(Number(pose.x || 0), Number(pose.y || 0));
    const angle = -Number(pose.yaw || 0);
    ctx.save(); ctx.translate(rx, ry); ctx.rotate(angle);
    ctx.fillStyle = "#22c55e"; ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-7, -6); ctx.lineTo(-4, 0); ctx.lineTo(-7, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  if (goal) {
    const [gx, gy] = view.point(goal.x, goal.y);
    const yaw = Number(goal.yaw === undefined ? radians($("goal-yaw").value) : goal.yaw);
    const arrowX = gx + Math.cos(yaw) * 25;
    const arrowY = gy - Math.sin(yaw) * 25;
    ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(gx, gy, 8, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gx - 12, gy); ctx.lineTo(gx + 12, gy); ctx.moveTo(gx, gy - 12); ctx.lineTo(gx, gy + 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(arrowX, arrowY); ctx.stroke();
    ctx.save(); ctx.translate(arrowX, arrowY); ctx.rotate(-yaw);
    ctx.fillStyle = "#ef4444";
    ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -4); ctx.lineTo(-5, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

let pendingDrawFrame = null;
function requestDraw() {
  if (pendingDrawFrame !== null) return;
  pendingDrawFrame = window.requestAnimationFrame(() => {
    pendingDrawFrame = null;
    draw();
  });
}

async function action(button, busyText, operation) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  try {
    const result = await operation();
    const message = result.message || (result.success ? "Comandă confirmată" : result.error) || "Operație terminată";
    if (result.success === false) throw new Error(message);
    log(message);
    toast(message);
    return result;
  } catch (error) {
    log(`EROARE: ${error.message}`);
    toast(error.message, true);
    return null;
  } finally {
    button.disabled = false;
    button.textContent = original;
    await refreshState();
  }
}

async function refreshMaps() {
  try {
    const data = await api("/api/maps");
    const select = $("maps");
    const previous = select.value;
    select.innerHTML = '<option value="">Selectează o hartă…</option>';
    for (const item of data.maps || []) {
      const option = document.createElement("option");
      option.value = item.name;
      option.textContent = `${item.name} · ${(item.size / 1024 / 1024).toFixed(1)} MB${item.native_ready ? " · navigabilă" : " · doar vizualizare"}`;
      option.dataset.nativeReady = String(Boolean(item.native_ready));
      select.appendChild(option);
    }
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;

    const partialSelect = $("partial-sessions");
    const previousPartial = partialSelect.value;
    partialSelect.innerHTML = '<option value="">Nicio sesiune salvată…</option>';
    for (const item of data.partial_sessions || []) {
      const option = document.createElement("option");
      option.value = item.name;
      option.textContent = `${item.name} · ${item.snapshots} capturi`;
      partialSelect.appendChild(option);
    }
    if ([...partialSelect.options].some((option) => option.value === previousPartial)) partialSelect.value = previousPartial;
    updateMapReadiness();
  } catch (error) {
    log(`EROARE listă hărți: ${error.message}`);
  }
}

function updateMapReadiness() {
  const option = $("maps").selectedOptions[0];
  const box = $("map-readiness");
  if (!option || !option.value) {
    box.className = "readiness neutral";
    box.textContent = "Nicio hartă selectată";
  } else if (option.dataset.nativeReady === "true") {
    box.className = "readiness good";
    box.textContent = "Hartă pregătită pentru localizare și navigație";
  } else {
    box.className = "readiness warn";
    box.textContent = "Copie locală disponibilă; serviciul 1802 nu a confirmat harta nativă";
  }
}

$("start-map").addEventListener("click", async (event) => {
  await action(event.currentTarget, "Aștept primul cloud…", async () => {
    viewingStoredMap = false;
    firstMapFrame = true;
    followRobot = false;
    updateFollowButton();
    goal = null;
    const result = await api("/api/slam/start_mapping", { method: "POST" });
    if (result.success) setText("viewer-subtitle", "Harta 3D stabilizată, proiectată în XY · sesiune nouă");
    return result;
  });
});

$("pause-map").addEventListener("click", async (event) => {
  await action(event.currentTarget, "Comut…", () => api("/api/slam/pause_mapping", {
    method: "POST",
  }));
});

$("stop-map").addEventListener("click", async (event) => {
  const result = await action(event.currentTarget, "Opresc…", () => api("/api/slam/stop_mapping", {
    method: "POST",
  }));
  if (result) await refreshMaps();
});

$("save-map").addEventListener("click", async (event) => {
  const name = $("map-name").value.trim();
  if (!name) return toast("Introdu numele hărții", true);
  const result = await action(event.currentTarget, "Salvez…", () => api("/api/slam/save_map", {
    method: "POST", body: JSON.stringify({ name }),
  }));
  if (result) await refreshMaps();
});

$("refresh-maps").addEventListener("click", refreshMaps);
$("refresh-partials").addEventListener("click", refreshMaps);
$("maps").addEventListener("change", () => {
  updateMapReadiness();
  invalidateRoute("Harta selectată s-a schimbat; recalculează ruta");
});
$("view-map").addEventListener("click", async (event) => {
  await action(event.currentTarget, "Încarc…", viewSavedMap);
});
$("download-map").addEventListener("click", () => {
  const name = $("maps").value;
  if (!name) return toast("Selectează mai întâi o hartă", true);
  window.location.href = `/api/maps/${encodeURIComponent(name)}/file`;
});
$("clear-view").addEventListener("click", () => {
  viewingStoredMap = false;
  mapPoints = [];
  goal = null;
  firstMapFrame = true;
  bounds = { minX: -5, maxX: 5, minY: -5, maxY: 5 };
  $("maps").value = "";
  updateMapReadiness();
  invalidateRoute("Vizualizarea este goală; poți continua mappingul sau încărca altă hartă");
  $("empty-map").classList.remove("hidden");
  setText("viewer-subtitle", "Vizualizare goală · fișierele PCD nu au fost șterse");
  setText("render-count", "0 puncte vizibile");
  toast("Harta a fost scoasă doar din viewer; fișierul a rămas salvat");
});
$("view-partial").addEventListener("click", async (event) => {
  await action(event.currentTarget, "Încarc…", viewLatestPartial);
});
$("download-partial").addEventListener("click", async () => {
  try {
    const latest = await latestPartial();
    window.location.href = `/api/partial-maps/${encodeURIComponent(latest.session)}/${encodeURIComponent(latest.snapshot.name)}/file`;
  } catch (error) {
    toast(error.message, true);
  }
});

$("localize").addEventListener("click", async (event) => {
  const map = $("maps").value;
  if (!map) return toast("Selectează mai întâi o hartă", true);
  await action(event.currentTarget, "Localizez…", () => api("/api/localization/start", {
    method: "POST",
    body: JSON.stringify({
      map,
      x: Number($("loc-x").value), y: Number($("loc-y").value), yaw: radians($("loc-yaw").value),
    }),
  }));
});

function navigationTarget() {
  const x = Number($("goal-x").value);
  const y = Number($("goal-y").value);
  const yaw = radians($("goal-yaw").value);
  const speed = Number($("speed").value);
  return { x, y, yaw, speed, map: $("maps").value };
}

$("preview-route").addEventListener("click", async (event) => {
  const target = navigationTarget();
  goal = { x: target.x, y: target.y, yaw: target.yaw };
  const result = await action(event.currentTarget, "Calculez cu Nav2…", () => api("/api/navigation/preview", {
    method: "POST", body: JSON.stringify(target),
  }));
  if (!result) return;
  routePreview = {
    id: result.preview_id,
    points: result.route.points || [],
    target,
  };
  const distance = Number(result.route.distance || 0);
  $("route-summary").className = "route-summary ready";
  setText("route-summary", `Rută pregătită · ${distance.toFixed(2)} m · ${routePreview.points.length} puncte · confirmare în 120 s`);
  $("navigate").disabled = false;
  draw();
});

$("navigate").addEventListener("click", async (event) => {
  if (!routePreview) return toast("Previzualizează mai întâi ruta", true);
  const target = navigationTarget();
  if (!window.confirm(`CONFIRMARE NAV2 CU CONTROL EXCLUSIV\nConfirm că navigația nativă și ceilalți emițători de mișcare sunt opriți.\nX=${target.x.toFixed(2)}, Y=${target.y.toFixed(2)}, yaw=${degrees(target.yaw).toFixed(0)}°, viteză=${target.speed.toFixed(2)} m/s. Robotul poate începe deplasarea. Continui?`)) return;
  const result = await action(event.currentTarget, "Pornesc ruta…", () => api("/api/navigation/goal", {
    method: "POST",
    body: JSON.stringify({ ...target, preview_id: routePreview.id, exclusive_control: true }),
  }));
  if (result) {
    $("navigate").disabled = true;
    $("route-summary").className = "route-summary ready";
    setText("route-summary", result.message || "Nav2 a pornit ruta");
    draw();
  }
});

$("stop-navigation").addEventListener("click", (event) => action(event.currentTarget, "Opresc ruta…", () => api("/api/navigation/stop", { method: "POST" })));
$("pause").addEventListener("click", (event) => action(event.currentTarget, "Oprire…", () => api("/api/navigation/pause", { method: "POST" })));
$("resume").addEventListener("click", (event) => action(event.currentTarget, "Pornire…", () => api("/api/navigation/resume", { method: "POST" })));
$("speed").addEventListener("input", () => {
  setText("speed-value", `${Number($("speed").value).toFixed(2)} m/s`);
  invalidateRoute("Viteza s-a schimbat; recalculează ruta");
});

$("teleop-speed").addEventListener("input", () => {
  setText("teleop-speed-value", `${Number($("teleop-speed").value).toFixed(2)} m/s`);
});

$("teleop-turn-speed").addEventListener("input", () => {
  setText("teleop-turn-speed-value", `${Number($("teleop-turn-speed").value).toFixed(2)} rad/s`);
});

async function saveTeleopSpeeds() {
  const speed = Number($("teleop-speed").value);
  const turnSpeed = Number($("teleop-turn-speed").value);
  try {
    const result = await api("/api/teleop/speed", {
      method: "POST",
      body: JSON.stringify({ speed, turn_speed: turnSpeed }),
    });
    log(result.message);
    toast(result.message);
    await refreshState();
  } catch (error) {
    log(`EROARE viteză teleop: ${error.message}`);
    toast(error.message, true);
    await refreshState();
  }
}

$("teleop-speed").addEventListener("change", saveTeleopSpeeds);
$("teleop-turn-speed").addEventListener("change", saveTeleopSpeeds);
["goal-x", "goal-y"].forEach((id) => {
  $(id).addEventListener("input", () => invalidateRoute("Destinația s-a schimbat; recalculează ruta"));
});

function updateModeControls() {
  const unlocked = $("mode-password").value === "123";
  document.querySelectorAll("[data-robot-mode]").forEach((button) => {
    button.disabled = !unlocked;
  });
  $("enable-teleop").disabled = !unlocked;
}

$("mode-password").addEventListener("input", updateModeControls);

$("enable-teleop").addEventListener("click", async (event) => {
  if (!window.confirm("CONFIRMARE TELEOP EXCLUSIV\nRobotul este în zonă liberă, maneta și ceilalți emițători sunt opriți. Butonul va activa RUN și teleop_twist_keyboard. Următoarea tastă din această pagină poate produce mișcare. Continui?")) return;
  const result = await action(event.currentTarget, "Armez…", () => api("/api/teleop/enable", {
    method: "POST",
    body: JSON.stringify({
      password: $("mode-password").value,
      exclusive_control: true,
      speed: Number($("teleop-speed").value),
      turn_speed: Number($("teleop-turn-speed").value),
    }),
  }));
  if (result) {
    event.currentTarget.blur();
    $("mode-password").value = "";
    updateModeControls();
    $("teleop-capture").focus({ preventScroll: true });
  }
});

$("disable-teleop").addEventListener("click", (event) => action(
  event.currentTarget,
  "Opresc…",
  () => api("/api/teleop/disable", { method: "POST" }),
));

function teleopKeyForEvent(event) {
  const physicalKeys = {
    ArrowUp: "i", ArrowDown: ",", ArrowLeft: "j", ArrowRight: "l",
    KeyW: "i", KeyS: ",", KeyA: "j", KeyD: "l", Space: "k",
  };
  if (physicalKeys[event.code] !== undefined) return physicalKeys[event.code];
  const aliases = {
    " ": "k",
  };
  if (aliases[event.key] !== undefined) return aliases[event.key];
  const standard = "uiojklm,.UIOJKLM<>";
  return event.key.length === 1 && standard.includes(event.key) ? event.key : null;
}

function editableTarget(target) {
  return target instanceof HTMLElement && (
    target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

async function pumpTeleopKeys() {
  if (teleopKeySending) return;
  teleopKeySending = true;
  try {
    while (teleopPendingKey !== null) {
      const key = teleopPendingKey;
      teleopPendingKey = null;
      const result = await api("/api/teleop/key", {
        method: "POST",
        body: JSON.stringify({ key }),
      });
      if (result.success === false) throw new Error(result.error || "Comanda teleop a fost respinsă");
      setText("teleop-key-state", `Backend: tasta ${JSON.stringify(key)} primită`);
    }
  } catch (error) {
    teleopPendingKey = null;
    log(`EROARE teleop: ${error.message}`);
    toast(error.message, true);
  } finally {
    teleopKeySending = false;
    if (teleopPendingKey !== null) pumpTeleopKeys();
  }
}

function sendTeleopKey(key) {
  teleopPendingKey = key;
  pumpTeleopKeys();
}

function teleopIsEnabled() {
  return Boolean(state?.locomotion_bridge?.teleop_enabled);
}

function stopHeldTeleopKeys() {
  if (!heldTeleopKeys.size && activeTeleopKey === null) return;
  heldTeleopKeys.clear();
  activeTeleopKey = null;
  sendTeleopKey("k");
}

window.addEventListener("keydown", (event) => {
  if (!teleopIsEnabled() || editableTarget(event.target)) return;
  const key = teleopKeyForEvent(event);
  if (key === null) return;
  event.preventDefault();
  event.stopPropagation();
  if (key === "k") {
    stopHeldTeleopKeys();
    sendTeleopKey("k");
    return;
  }
  const motionKeys = "uiojlm,.UIOJKLM<>";
  if (motionKeys.includes(key)) {
    heldTeleopKeys.set(event.code, key);
    activeTeleopKey = key;
    if (event.repeat) return;
  }
  sendTeleopKey(key);
}, { capture: true });

window.addEventListener("keyup", (event) => {
  if (!heldTeleopKeys.delete(event.code)) return;
  event.preventDefault();
  event.stopPropagation();
  const remaining = Array.from(heldTeleopKeys.values());
  activeTeleopKey = remaining.length ? remaining[remaining.length - 1] : null;
  sendTeleopKey(activeTeleopKey || "k");
}, { capture: true });

window.addEventListener("blur", () => {
  stopHeldTeleopKeys();
});

$("teleop-capture").addEventListener("click", () => $("teleop-capture").focus({ preventScroll: true }));

// teleop_twist_keyboard publică la fiecare caracter. Repetăm controlat tasta
// activă pentru ca velocity_smoother să nu depindă de întârzierea auto-repeat
// configurată în sistemul de operare al browserului.
setInterval(() => {
  if (activeTeleopKey !== null && teleopIsEnabled()) sendTeleopKey(activeTeleopKey);
}, 100);

document.querySelectorAll("[data-robot-mode]").forEach((button) => {
  button.addEventListener("click", async (event) => {
    const mode = button.dataset.robotMode;
    if (!window.confirm(`Confirmi schimbarea fizică a robotului în modul ${mode.toUpperCase()}?`)) return;
    const result = await action(event.currentTarget, "Trimit…", () => api("/api/robot/mode", {
      method: "POST",
      body: JSON.stringify({ mode, password: $("mode-password").value }),
    }));
    if (result) {
      $("mode-password").value = "";
      updateModeControls();
      invalidateRoute("Modul robotului s-a schimbat; recalculează ruta");
    }
  });
});

$("fit-map").addEventListener("click", () => {
  followRobot = false;
  updateFollowButton();
  fitBounds(mapPoints);
  requestDraw();
});
$("follow-robot").addEventListener("click", () => {
  followRobot = !followRobot;
  updateFollowButton();
  if (followRobot) centerOnRobot();
  requestDraw();
});
$("zoom-in").addEventListener("click", () => zoomAt(0.8));
$("zoom-out").addEventListener("click", () => zoomAt(1.25));
$("clear-log").addEventListener("click", () => { $("log").textContent = ""; });

document.querySelectorAll("[data-yaw]").forEach((button) => {
  button.addEventListener("click", () => {
    const yawDegrees = Number(button.dataset.yaw);
    invalidateRoute("Orientarea finală s-a schimbat; recalculează ruta");
    $("goal-yaw").value = yawDegrees;
    if (goal) goal.yaw = radians(yawDegrees);
    document.querySelectorAll("[data-yaw]").forEach((item) => item.classList.remove("selected"));
    button.classList.add("selected");
    draw();
  });
});

$("goal-yaw").addEventListener("input", () => {
  invalidateRoute("Orientarea finală s-a schimbat; recalculează ruta");
  if (goal) goal.yaw = radians($("goal-yaw").value);
  document.querySelectorAll("[data-yaw]").forEach((item) => item.classList.remove("selected"));
  draw();
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  zoomAt(event.deltaY > 0 ? 1.14 : 0.88, event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });

window.setG1Goal = (x, y, yaw, invalidate = true) => {
  if (invalidate) invalidateRoute("Destinația s-a schimbat; recalculează ruta");
  goal = { x: Number(x), y: Number(y), yaw: Number(yaw) };
  if ($("goal-x")) $("goal-x").value = Number(x).toFixed(2);
  if ($("goal-y")) $("goal-y").value = Number(y).toFixed(2);
  if ($("goal-yaw")) $("goal-yaw").value = degrees(yaw).toFixed(1);
  draw();
};
window.getG1Goal = () => goal;
window.projection = projection;
window.degrees = degrees;
window.radians = radians;
window.requestDraw = requestDraw;
window.invalidateRoute = invalidateRoute;

canvas.addEventListener("contextmenu", (event) => event.preventDefault());

canvas.addEventListener("pointerdown", (event) => {
  const isPanButton = event.button === 1 || event.button === 2;
  const isPanMode = $("car-pick-mode")?.value === "pan";
  const shouldPan = isPanButton || (event.button === 0 && (event.altKey || isPanMode));
  if (!shouldPan) return;
  const rect = canvas.getBoundingClientRect();
  const view = projection(rect.width, rect.height);
  pointerInteraction = {
    mode: "pan",
    startX: event.clientX,
    startY: event.clientY,
    startBounds: { ...view.bounds },
    scale: view.scale,
    moved: false,
  };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointerInteraction) return;
  const dx = event.clientX - pointerInteraction.startX;
  const dy = event.clientY - pointerInteraction.startY;
  if (Math.hypot(dx, dy) > 3) pointerInteraction.moved = true;
  if (pointerInteraction.mode === "pan") {
    if (pointerInteraction.moved && followRobot) {
      followRobot = false;
      updateFollowButton();
    }
    const original = pointerInteraction.startBounds;
    const shiftX = -dx / pointerInteraction.scale;
    const shiftY = dy / pointerInteraction.scale;
    bounds = {
      minX: original.minX + shiftX, maxX: original.maxX + shiftX,
      minY: original.minY + shiftY, maxY: original.maxY + shiftY,
    };
  }
  canvas.style.cursor = pointerInteraction.mode === "pan" ? "grabbing" : "crosshair";
  requestDraw();
});

function finishPointer(event) {
  if (!pointerInteraction) return;
  const interaction = pointerInteraction;
  pointerInteraction = null;
  canvas.style.cursor = "crosshair";
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (interaction.mode === "pan" && !interaction.moved && $("car-pick-mode")?.value === "pan") {
    // În modul pan explicit, un simplu click nu generează acțiuni accidentale.
  }
}

canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", finishPointer);

window.addEventListener("resize", requestDraw);
if (!token) log("ATENȚIE: tokenul lipsește din URL; acțiunile protejate vor fi refuzate.");
refreshMaps();
updateFollowButton();
refreshState();
setInterval(refreshState, 1000);
setInterval(refreshMaps, 5000);
