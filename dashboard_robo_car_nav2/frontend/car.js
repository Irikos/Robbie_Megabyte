"use strict";
// Extensie peste frontendul v4. Nu trimite niciodată comenzi locomotorii G1.
(() => {
  let car = {}, previewId = null, polling = false, socket, reconnect;
  let lastCarPathRevision = 0, carPathPulseTimer = null;
  const val = id => Number($(id).value);
  const pose = prefix => ({x: val(`${prefix}-x`), y: val(`${prefix}-y`), yaw_deg: val(`${prefix}-yaw`)});
  const post = (path, body = {}) => api(path, {method: 'POST', body: JSON.stringify(body)});
  const say = text => { $('car-result').textContent = text; log(text); };
  function update(data) {
    car = {...car, ...data};
    const pathStatus = $('car-path-live');
    const pathRevision = Number(car.path_revision || 0);
    if (pathRevision < lastCarPathRevision) lastCarPathRevision = 0;
    if (pathRevision > lastCarPathRevision) {
      lastCarPathRevision = pathRevision;
      pathStatus.className = 'live-route-status updated';
      clearTimeout(carPathPulseTimer);
      carPathPulseTimer = setTimeout(() => pathStatus.classList.remove('updated'), 420);
    }
    if (pathRevision && Array.isArray(car.path) && car.path.length) {
      const age = Math.max(0, Date.now() / 1000 - Number(car.path_updated_at || Date.now() / 1000));
      pathStatus.classList.remove('idle');
      pathStatus.textContent = `Plan mașinuță #${pathRevision} · ${car.path.length} puncte · ${age.toFixed(1)} s`;
    } else {
      pathStatus.className = 'live-route-status idle';
      pathStatus.textContent = 'Plan mașinuță: în așteptare';
    }
    $('car-status').className = `readiness ${car.connected ? 'good' : 'warn'}`;
    $('car-status').textContent = `${car.connected ? 'Conectată' : 'Neconectată'} · ${car.current_mode || 'none'} / ${car.mode_status || 'stopped'}\n${car.pose ? `X ${car.pose.x.toFixed(2)} · Y ${car.pose.y.toFixed(2)} · yaw ${degrees(car.pose.yaw).toFixed(1)}°` : 'Poziție necunoscută'}\nAliniere: ${car.alignment?.message || 'neconfirmată'}`;
    if (car.preview?.ready && car.preview.request_id === previewId) $('car-go').disabled = false;
    else $('car-go').disabled = true;
    if (!car.connected) previewId = null;
    const maps = car.available_maps || [];
    const select = $('car-maps');
    const signature = JSON.stringify(maps);
    if (select.dataset.maps !== signature) {
      select.dataset.maps = signature;
      select.replaceChildren(...maps.map(m => new Option(m.name || m.path, m.path)));
      select.value = $('car-map-file').value;
    }
    requestDraw();
  }
  async function operation(button, fn) {
    button.disabled = true;
    try {
      const result = await fn();
      if (result.success === false) throw new Error(result.error || 'Comandă respinsă');
      say(result.message || 'Cerere transmisă mașinuței; verifică feedbackul.');
      return result;
    } catch (error) { say(error.message); toast(error.message, true); return null; }
    finally { button.disabled = false; }
  }
  function bind(id, fn) { $(id).addEventListener('click', event => operation(event.currentTarget, fn)); }
  const mode = name => post('/api/car/mode', {mode:name, map_file:$('car-map-file').value, slam_params_file:$('car-slam-params').value});
  bind('car-mapping', () => mode('mapping'));
  bind('car-localization', () => mode('localization'));
  bind('car-stop', () => mode('stop'));
  bind('car-standalone', async () => {
    $('car-tf-x').value = '0';
    $('car-tf-y').value = '0';
    $('car-tf-yaw').value = '0';
    return await post('/api/car/standalone');
  });
  $('car-center').addEventListener('click', () => {
    const pts = (car.map_points && car.map_points.length) ? car.map_points : (car.scan_points || []);
    if (!pts.length && !car.pose) {
      toast('Nu există puncte de hartă sau scan de la mașinuță');
      return;
    }
    let minX = car.pose ? car.pose.x - 2 : Infinity;
    let maxX = car.pose ? car.pose.x + 2 : -Infinity;
    let minY = car.pose ? car.pose.y - 2 : Infinity;
    let maxY = car.pose ? car.pose.y + 2 : -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const pad = Math.max(1.0, Math.max(maxX - minX, maxY - minY) * 0.15);
    if (window.centerOnBounds) {
      window.centerOnBounds({minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad});
      say('Vedere focalizată pe mașinuță.');
    }
  });
  bind('car-transform', () => post('/api/car/transform', pose('car-tf')));
  function normalizeDegrees(deg) {
    let d = (deg + 180) % 360;
    if (d < 0) d += 360;
    return d - 180;
  }

  bind('car-refine-icp', async () => {
    const res = await post('/api/car/refine_icp', pose('car-tf'));
    if (res && res.transform) {
      $('car-tf-x').value = res.transform.x.toFixed(2);
      $('car-tf-y').value = res.transform.y.toFixed(2);
      $('car-tf-yaw').value = res.transform.yaw_deg.toFixed(1);
    }
    return res;
  });
  $('car-tf-flip')?.addEventListener('click', () => {
    const yawEl = $('car-tf-yaw');
    if (!yawEl) return;
    const cur = parseFloat(yawEl.value) || 0;
    const flipped = normalizeDegrees(cur + 180);
    yawEl.value = flipped.toFixed(1);
    toast(`TF Yaw inversat cu 180° ➔ ${flipped.toFixed(1)}°`);
    requestDraw();
  });
  bind('car-align', () => post('/api/car/auto_align'));
  bind('car-initial-pose', () => post('/api/car/initial_pose', pose('car-pose')));
  bind('car-refresh-maps', () => post('/api/car/maps/refresh'));
  bind('car-save-map', () => post('/api/car/map/save', {map_name:$('car-map-name').value}));
  bind('car-preview', async () => {
    $('car-go').disabled = true;
    const result = await post('/api/car/path/preview', pose('car-goal'));
    previewId = result.request_id;
    return result;
  });
  $('car-go').addEventListener('click', async event => {
    if (!previewId || !confirm('Pornești MAȘINUȚA pe ruta afișată? G1 nu primește această țintă.')) return;
    await operation(event.currentTarget, () => post('/api/car/goal', {...pose('car-goal'), preview_id:previewId}));
    previewId = null;
    $('car-go').disabled = true;
  });
  $('car-maps').addEventListener('change', () => { $('car-map-file').value = $('car-maps').value; });
  for (const id of [
    'car-goal-x','car-goal-y','car-goal-yaw',
    'car-tf-x','car-tf-y','car-tf-yaw',
    'car-pose-x','car-pose-y','car-pose-yaw',
    'loc-x','loc-y','loc-yaw'
  ]) {
    const el = $(id);
    if (el) el.addEventListener('input', () => {
      if (id.startsWith('car-goal')) { previewId = null; $('car-go').disabled = true; }
      requestDraw();
    });
  }
  for (const id of ['car-show-map','car-show-scan']) $(id).addEventListener('change', requestDraw);
  $('car-pick-mode')?.addEventListener('change', requestDraw);

  const PICK_CONFIG = {
    'g1': { name: 'G1 ȚINTĂ', color: '#ef4444', prefix: 'goal', isG1Goal: true },
    'car-goal': { name: 'MAȘINUȚĂ ȚINTĂ', color: '#f97316', prefix: 'car-goal' },
    'car-pose': { name: 'MAȘINUȚĂ START', color: '#a855f7', prefix: 'car-pose' },
    'car-tf': { name: 'TRANSFORMARE TF', color: '#06b6d4', prefix: 'car-tf', invert180: true },
    'g1-pose': { name: 'G1 START', color: '#10b981', prefix: 'loc' }
  };

  let activeDrag = null;
  const world = e => {
    const r = canvas.getBoundingClientRect();
    return projection(r.width, r.height).world(e.clientX - r.left, e.clientY - r.top);
  };

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const mode = $('car-pick-mode').value;
    if (mode === 'pan' || !PICK_CONFIG[mode]) return;

    e.stopImmediatePropagation();
    e.preventDefault();

    const [wx, wy] = world(e);
    const cfg = PICK_CONFIG[mode];
    const prefix = cfg.prefix;

    if ($(`${prefix}-x`)) $(`${prefix}-x`).value = wx.toFixed(2);
    if ($(`${prefix}-y`)) $(`${prefix}-y`).value = wy.toFixed(2);

    let currentYawDeg = parseFloat($(`${prefix}-yaw`)?.value) || 0;
    activeDrag = {
      mode,
      pointerId: e.pointerId,
      startX: wx,
      startY: wy,
      currentX: wx,
      currentY: wy,
      dragAngle: radians(currentYawDeg),
      dragDist: 0,
      tfYaw: currentYawDeg,
      startTime: Date.now()
    };

    if (cfg.isG1Goal && window.setG1Goal) {
      window.setG1Goal(wx, wy, radians(currentYawDeg));
    }

    canvas.setPointerCapture(e.pointerId);
    previewId = null;
    if ($('car-go')) $('car-go').disabled = true;
    requestDraw();
  }, true);

  canvas.addEventListener('pointermove', e => {
    if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
    e.stopImmediatePropagation();
    e.preventDefault();

    const [ex, ey] = world(e);
    activeDrag.currentX = ex;
    activeDrag.currentY = ey;

    const dx = ex - activeDrag.startX;
    const dy = ey - activeDrag.startY;
    const dist = Math.hypot(dx, dy);
    activeDrag.dragDist = dist;

    if (dist > 0.04) {
      const angle = Math.atan2(dy, dx);
      activeDrag.dragAngle = angle;
      const angleDeg = degrees(angle);
      const cfg = PICK_CONFIG[activeDrag.mode];
      const prefix = cfg.prefix;

      if (cfg.invert180) {
        // Corectare direcție pentru car-tf: utilizatorul trage în direcția dorită,
        // iar yaw-ul transformării primește rotația corectată (+180°).
        const correctedDeg = normalizeDegrees(angleDeg + 180);
        activeDrag.tfYaw = correctedDeg;
        if ($(`${prefix}-yaw`)) $(`${prefix}-yaw`).value = correctedDeg.toFixed(1);
      } else {
        if ($(`${prefix}-yaw`)) $(`${prefix}-yaw`).value = angleDeg.toFixed(1);
      }

      if (cfg.isG1Goal && window.setG1Goal) {
        window.setG1Goal(activeDrag.startX, activeDrag.startY, angle);
      }
    }

    requestDraw();
  }, true);

  function endPick(e) {
    if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
    e.stopImmediatePropagation();
    e.preventDefault();

    const drag = activeDrag;
    activeDrag = null;

    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    if (e.type === 'pointercancel') {
      requestDraw();
      return;
    }

    const [ex, ey] = world(e);
    const dx = ex - drag.startX;
    const dy = ey - drag.startY;
    const dist = Math.hypot(dx, dy);
    const cfg = PICK_CONFIG[drag.mode];
    const prefix = cfg.prefix;

    if ($(`${prefix}-x`)) $(`${prefix}-x`).value = drag.startX.toFixed(2);
    if ($(`${prefix}-y`)) $(`${prefix}-y`).value = drag.startY.toFixed(2);

    let finalYawDeg = 0;
    if (dist > 0.04) {
      const angle = Math.atan2(dy, dx);
      const angleDeg = degrees(angle);
      if (cfg.invert180) {
        finalYawDeg = normalizeDegrees(angleDeg + 180);
      } else {
        finalYawDeg = angleDeg;
      }
      if ($(`${prefix}-yaw`)) $(`${prefix}-yaw`).value = finalYawDeg.toFixed(1);
      if (cfg.isG1Goal && window.setG1Goal) {
        window.setG1Goal(drag.startX, drag.startY, angle);
      }
    } else {
      finalYawDeg = parseFloat($(`${prefix}-yaw`)?.value) || 0;
    }

    previewId = null;
    if ($('car-go')) $('car-go').disabled = true;
    requestDraw();

    if (drag.mode === 'car-tf') {
      toast(`Origine mașinuță setată (X ${drag.startX.toFixed(2)}, Y ${drag.startY.toFixed(2)}, TF yaw ${finalYawDeg.toFixed(1)}°). Apasă „✦ Lipește pereții (ICP)” sau „Aplică manual”.`);
    } else if (drag.mode === 'g1') {
      toast(`Destinație G1 setată: X ${drag.startX.toFixed(2)}, Y ${drag.startY.toFixed(2)}, yaw ${finalYawDeg.toFixed(1)}°`);
    } else {
      toast(`${cfg.name} setat: X ${drag.startX.toFixed(2)}, Y ${drag.startY.toFixed(2)}, yaw ${finalYawDeg.toFixed(1)}°`);
    }
  }

  canvas.addEventListener('pointerup', endPick, true);
  canvas.addEventListener('pointercancel', endPick, true);

  function drawPoseMarker(ctx, px, py, yawRad, color, label, showArrow = true, arrowLen = 26) {
    ctx.save();
    // Backdrop
    ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
    ctx.beginPath();
    ctx.arc(px, py, 8.5, 0, Math.PI * 2);
    ctx.fill();

    // Outer ring
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 9, 0, Math.PI * 2);
    ctx.stroke();

    // Crosshair
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px - 13, py); ctx.lineTo(px - 4, py);
    ctx.moveTo(px + 4, py); ctx.lineTo(px + 13, py);
    ctx.moveTo(px, py - 13); ctx.lineTo(px, py - 4);
    ctx.moveTo(px, py + 4); ctx.lineTo(px, py + 13);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Arrow
    if (showArrow && Number.isFinite(yawRad)) {
      const endX = px + Math.cos(yawRad) * arrowLen;
      const endY = py - Math.sin(yawRad) * arrowLen;

      // Shadow line
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(px, py); ctx.lineTo(endX, endY);
      ctx.stroke();

      // Main line
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(px, py); ctx.lineTo(endX, endY);
      ctx.stroke();

      // Arrowhead
      ctx.save();
      ctx.translate(endX, endY);
      ctx.rotate(-yawRad);
      ctx.fillStyle = color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(-7, -5);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-7, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Badge
    if (label) {
      ctx.font = 'bold 10px ui-monospace, monospace';
      const textWidth = ctx.measureText(label).width;
      const boxX = px + 12;
      const boxY = py - 18;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY - 9, textWidth + 8, 14, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(label, boxX + 4, boxY + 2);
    }
    ctx.restore();
  }

  window.drawRobotCarLayers = (context, view) => {
    context.save();
    const points = (items, color, size) => {context.fillStyle=color; for(const p of items || []) {const [x,y]=view.point(p.x,p.y); context.fillRect(x-size/2,y-size/2,size,size);}};
    if ($('car-show-map').checked) points(car.map_points,'rgba(251,146,60,.65)',2);
    if ($('car-show-scan').checked) points(car.scan_points,'#f472b6',2);
    if (car.path?.length) {
      context.strokeStyle='#fbbf24'; context.lineWidth=2; context.setLineDash([4,4]); context.beginPath();
      car.path.forEach((p,i)=>{const [x,y]=view.point(p.x,p.y); i ? context.lineTo(x,y) : context.moveTo(x,y);}); context.stroke(); context.setLineDash([]);
    }
    if (car.pose) {
      const [x,y]=view.point(car.pose.x,car.pose.y);
      context.save(); context.translate(x,y); context.rotate(-car.pose.yaw);
      context.fillStyle=car.connected && car.pose_age < 2 ? '#fb923c' : '#64748b'; context.fillRect(-10,-7,20,14);
      context.strokeStyle='#fff'; context.beginPath(); context.moveTo(0,0); context.lineTo(16,0); context.stroke(); context.restore();
      context.fillStyle='#fb923c'; context.fillText('CAR',x+12,y-10);
    }

    // Persistent indicators for set poses
    const curPickMode = $('car-pick-mode')?.value;

    // Car Goal
    const cgx = val('car-goal-x'), cgy = val('car-goal-y'), cgyaw = val('car-goal-yaw');
    if (Number.isFinite(cgx) && Number.isFinite(cgy) && (cgx !== 0 || cgy !== 0 || curPickMode === 'car-goal')) {
      const [px, py] = view.point(cgx, cgy);
      drawPoseMarker(context, px, py, radians(cgyaw), '#f97316', 'CAR GOAL');
    }

    // Car TF
    const tfx = val('car-tf-x'), tfy = val('car-tf-y'), tfyaw = val('car-tf-yaw');
    if (Number.isFinite(tfx) && Number.isFinite(tfy) && (tfx !== 0 || tfy !== 0 || curPickMode === 'car-tf')) {
      const [px, py] = view.point(tfx, tfy);
      // Direction visually dragged on screen is tfyaw - 180 (because tfyaw = dragYaw + 180)
      const visualYaw = radians(normalizeDegrees(tfyaw - 180));
      drawPoseMarker(context, px, py, visualYaw, '#06b6d4', 'CAR TF');
    }

    // Car Pose
    const cpx = val('car-pose-x'), cpy = val('car-pose-y'), cpyaw = val('car-pose-yaw');
    if (Number.isFinite(cpx) && Number.isFinite(cpy) && (cpx !== 0 || cpy !== 0 || curPickMode === 'car-pose')) {
      const [px, py] = view.point(cpx, cpy);
      drawPoseMarker(context, px, py, radians(cpyaw), '#a855f7', 'CAR START');
    }

    // G1 Initial Pose
    const locx = val('loc-x'), locy = val('loc-y'), locyaw = val('loc-yaw');
    if (Number.isFinite(locx) && Number.isFinite(locy) && (locx !== 0 || locy !== 0 || curPickMode === 'g1-pose')) {
      const [px, py] = view.point(locx, locy);
      drawPoseMarker(context, px, py, radians(locyaw), '#10b981', 'G1 START');
    }

    // ACTIVE DRAG (Live click point & dynamic directional arrow with HUD)
    if (activeDrag) {
      const [sx, sy] = view.point(activeDrag.startX, activeDrag.startY);
      const [cx, cy] = view.point(activeDrag.currentX, activeDrag.currentY);
      const cfg = PICK_CONFIG[activeDrag.mode] || { name: 'PUNCT', color: '#38bdf8' };
      const color = cfg.color;

      context.save();

      // Pulsing anchor halo
      const pulse = (Math.sin(Date.now() / 150) + 1) / 2;
      const haloR = 12 + pulse * 6;
      context.strokeStyle = color;
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(sx, sy, haloR, 0, Math.PI * 2);
      context.stroke();

      // Anchor circle
      context.fillStyle = 'rgba(15, 23, 42, 0.82)';
      context.beginPath();
      context.arc(sx, sy, 8, 0, Math.PI * 2);
      context.fill();

      context.strokeStyle = color;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(sx, sy, 8, 0, Math.PI * 2);
      context.stroke();

      context.fillStyle = '#ffffff';
      context.beginPath();
      context.arc(sx, sy, 3, 0, Math.PI * 2);
      context.fill();

      // Start coordinate label
      context.font = '9px ui-monospace, monospace';
      context.fillStyle = 'rgba(255, 255, 255, 0.8)';
      context.fillText(`(${activeDrag.startX.toFixed(2)}, ${activeDrag.startY.toFixed(2)})`, sx + 12, sy + 14);

      // Drag line & arrow
      const distPx = Math.hypot(cx - sx, cy - sy);
      const angleRad = Math.atan2(-(cy - sy), cx - sx);
      const targetX = distPx >= 12 ? cx : sx + Math.cos(activeDrag.dragAngle) * 26;
      const targetY = distPx >= 12 ? cy : sy - Math.sin(activeDrag.dragAngle) * 26;
      const arrowAngle = distPx >= 12 ? angleRad : activeDrag.dragAngle;

      // Dark contrast outline
      context.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      context.lineWidth = 5;
      context.beginPath();
      context.moveTo(sx, sy);
      context.lineTo(targetX, targetY);
      context.stroke();

      // Primary color stroke
      context.strokeStyle = color;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(sx, sy);
      context.lineTo(targetX, targetY);
      context.stroke();

      // Arrowhead
      context.save();
      context.translate(targetX, targetY);
      context.rotate(-arrowAngle);
      context.fillStyle = color;
      context.strokeStyle = '#ffffff';
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(12, 0);
      context.lineTo(-10, -7);
      context.lineTo(-6, 0);
      context.lineTo(-10, 7);
      context.closePath();
      context.fill();
      context.stroke();
      context.restore();

      // Floating HUD badge
      const degVal = degrees(arrowAngle).toFixed(1);
      let hudText = `${cfg.name} · ${degVal}°`;
      if (cfg.invert180) {
        hudText += ` [TF: ${activeDrag.tfYaw.toFixed(1)}°]`;
      }
      const distText = `${activeDrag.dragDist.toFixed(2)} m`;

      context.font = 'bold 11px system-ui, -apple-system, sans-serif';
      const line1W = context.measureText(hudText).width;
      context.font = '10px ui-monospace, monospace';
      const line2W = context.measureText(distText).width;
      const boxW = Math.max(line1W, line2W) + 16;
      const boxH = 34;
      const hudX = targetX + 16;
      const hudY = targetY - 38;

      context.fillStyle = 'rgba(15, 23, 42, 0.92)';
      context.strokeStyle = color;
      context.lineWidth = 1.5;
      context.beginPath();
      context.roundRect(hudX, hudY, boxW, boxH, 6);
      context.fill();
      context.stroke();

      context.fillStyle = color;
      context.font = 'bold 11px system-ui, -apple-system, sans-serif';
      context.fillText(hudText, hudX + 8, hudY + 14);

      context.fillStyle = '#94a3b8';
      context.font = '10px ui-monospace, monospace';
      context.fillText(`Distanță: ${distText}`, hudX + 8, hudY + 28);

      context.restore();
    }

    context.restore();
  };

  function connect() {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${encodeURIComponent(token)}`);
    socket.onmessage = event => {
      const msg=JSON.parse(event.data);
      if(msg.type==='car_state') update(msg);
      else if(msg.type==='car_mode_status') update({current_mode:msg.current_mode,mode_status:msg.mode_status});
      else if(msg.type==='car_maps_list') update({available_maps:msg.maps});
      else if(msg.type==='car_path_status') {
        say(msg.error || `Planner mașinuță: ${msg.status} · ${msg.points || 0} puncte`);
        if(msg.request_id === previewId) $('car-go').disabled = msg.status!=='ready' || !msg.points;
      } else if(msg.type==='car_save_map_status' || msg.type==='car_initial_pose_status') say(msg.error || msg.message || JSON.stringify(msg));
    };
    socket.onclose = () => { update({connected:false}); reconnect=setTimeout(connect,2000); };
  }
  async function poll() {
    if(polling || document.hidden) return;
    polling=true;
    try {
      const [c,cam]=await Promise.all([api('/api/car/status?include_layers=false'),api('/api/camera/status')]);
      update(c);
      $('camera-state').textContent=cam.fresh ? `Color + depth live · ${cam.size?.join('×')}` : `Camera fără date proaspete${cam.error ? ': '+cam.error : ''}`;
      if(cam.fresh) for(const kind of ['color','depth']) $(`camera-${kind}`).src=`/api/camera/${kind}?t=${Date.now()}`;
    } catch(error) { $('car-status').textContent=error.message; }
    finally {polling=false;}
  }
  window.addEventListener('pagehide', () => {clearTimeout(reconnect); if(socket) {socket.onclose=null;socket.close();}});
  connect(); poll(); setInterval(poll,1000);
})();
