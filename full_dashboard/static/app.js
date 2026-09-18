import { G1Twin } from './g1_model.js?v=V21_7_REVERT_ORIGINAL_LOOK';
import { PointCloud3D } from './pointcloud_view.js';
import { SlamWorld3D } from './slam_view.js?v=slam-semantic-v2209';

(()=>{
'use strict';

const $ = (id) => document.getElementById(id);
const val = (obj, path, fallback=null) => {
  let cur=obj;
  for(const k of path){ if(cur==null || typeof cur!=='object' || !(k in cur)) return fallback; cur=cur[k]; }
  return cur==null ? fallback : cur;
};
const finite = (x) => Number.isFinite(Number(x));
const n = (x,d=2,suffix='') => finite(x) ? `${Number(x).toFixed(d)}${suffix}` : '—';
const pct = (x) => Math.max(0,Math.min(100,finite(x)?Number(x):0));
const boolWord = (x) => x ? 'YES' : 'NO';
const setTone = (el,tone) => { if(!el)return; el.classList.remove('good-text','warn-text','bad-text'); if(tone) el.classList.add(`${tone}-text`); };
const setChip = (el,text,tone) => { if(!el)return; el.textContent=text; el.className=`chip${tone?` ${tone}`:''}`; };
const fmtTime = (unix) => { try{return new Date(Number(unix)*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});}catch{return '—';} };

let latestEnv=null;
let pollBusy=false;
let currentView='live';
let cameraPc=null;
let cameraUrl=null;
let cameraConnecting=false;
let cameraProcessStatus=null;
let cameraProcessPollBusy=false;
let cameraProcessActionBusy=false;
let cameraViewsActionBusy=false;
let cameraYoloActionBusy=false;

const CAMERA_VIEW_ORDER=Object.freeze([
  'rgb',
  'depth',
  'overlay',
  'disparity',
  'pointcloud',
  'lifecam',
]);

const CAMERA_VIEWS=Object.freeze({
  rgb:Object.freeze({
    id:'rgb',
    label:'RealSense RGB',
    shortLabel:'RGB',
    transport:'webrtc',
    port:60001,
  }),
  depth:Object.freeze({
    id:'depth',
    label:'Depth',
    shortLabel:'DEPTH',
    transport:'webrtc',
    port:60005,
  }),
  overlay:Object.freeze({
    id:'overlay',
    label:'RGB + depth',
    shortLabel:'OVERLAY',
    transport:'webrtc',
    port:60006,
  }),
  disparity:Object.freeze({
    id:'disparity',
    label:'Disparity',
    shortLabel:'DISP',
    transport:'webrtc',
    port:60008,
  }),
  pointcloud:Object.freeze({
    id:'pointcloud',
    label:'Point cloud',
    shortLabel:'POINT',
    transport:'webgl',
    endpoint:'/api/camera/pointcloud',
  }),
  lifecam:Object.freeze({
    id:'lifecam',
    label:'External Cam',
    shortLabel:'EXT CAM',
    transport:'webrtc',
    port:60004,
  }),
});

let activeCameraViews=['rgb','depth','overlay','lifecam'];
const cameraPeers=new Map();
const cameraPeerConnecting=new Set();

function currentCameraSource(){
  // Compatibility for the surrounding telemetry renderer.
  return {id:'realsense'};
}

function normalizeCameraViews(raw){
  const requested=new Set(
    Array.isArray(raw)
      ?raw.map(value=>String(value||'').toLowerCase())
      :[]
  );
  const ordered=CAMERA_VIEW_ORDER.filter(id=>requested.has(id));
  return ordered.length?ordered:['rgb','lifecam'];
}

function activeWebRtcViews(){
  return activeCameraViews.filter(
    id=>CAMERA_VIEWS[id]?.transport==='webrtc'
  );
}

function cameraViewProcessStatus(id,st=cameraProcessStatus){
  const views=Array.isArray(st?.camera_views)
    ?st.camera_views
    :[];
  return views.find(view=>view.id===id)||null;
}

let pointViewSendBusy=false;
let pointViewLocal=null;
let pointViewInitialized=false;
let pointCloudFetchBusy=false;
let pointCloudPollTimer=null;
let selectedJointIndex=18;

const slamViewer=SlamWorld3D.init($('slamCanvas'));
let slamMapLoaded=false;
let slamMapLoading=false;
let slamStatusBusy=false;
let slamCloudBusy=false;
let slamLastCloudSequence=-1;
let slamLatestStatus=null;
let slamInitialSelecting=false;
let slamInitialDraft=null;
let slamInitialBusy=false;

function switchView(name){
  if(!['live','slam','inspect','bacalbasa'].includes(name)) return;
  currentView=name;
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  slamViewer.setVisible(name==='slam');
  G1Twin.setRenderVisible(name==='live');
  if(name==='slam')ensureSlamMap();
}
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
document.querySelectorAll('[data-view-jump]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.viewJump)));
/* ---------- Step 5.1 controller process + XR action manager ---------- */
let controllerConfig=null;
let controllerStatus=null;
let controllerPollBusy=false;
let controllerActionBusy=false;
let xrActionBusy=false;
let latestActionReadiness=null;
let managementAuthBusy=false;
let managementAfterAuth=null;

/* FULL_DASH_TRUSTED_SESSION_V14 */
let trustedSessionActive=false;
let trustedSessionPromise=null;

function currentManagementKey(){
  if(trustedSessionActive)return '__TRUSTED_SESSION__';
  return sessionStorage.getItem('g1ManagementKey')||'';
}
function storeManagementKey(key){
  const value=String(key||'').trim();

  if(value==='__TRUSTED_SESSION__')return;

  if(value)sessionStorage.setItem('g1ManagementKey',value);
  else sessionStorage.removeItem('g1ManagementKey');

  if($('managementKeyInput'))$('managementKeyInput').value=value;

  if($('controllerManagementKey')&&!trustedSessionActive){
    $('controllerManagementKey').value=value;
  }
}
function setManagementKeyError(message){
  const el=$('managementKeyError'); if(!el)return;
  if(!message){el.textContent='';el.classList.add('hidden');return;}
  el.textContent=message;el.classList.remove('hidden');
}
function showManagementKeyPrompt(message='',afterAuth=null){
  managementAfterAuth=typeof afterAuth==='function'?afterAuth:null;
  setManagementKeyError(message);
  $('managementKeyInput').value=currentManagementKey();
  $('managementKeyModal').classList.remove('hidden');
  document.body.classList.add('modal-open');
  setTimeout(()=>$('managementKeyInput').focus(),0);
}
function closeManagementKeyPrompt(){
  $('managementKeyModal').classList.add('hidden');
  if($('controllerModal').classList.contains('hidden'))document.body.classList.remove('modal-open');
  managementAfterAuth=null;
}
async function verifyManagementKey(key){
  const value=String(key||'').trim();
  if(!value)throw new Error('Paste the management key printed by the current ./start_dashboard.sh.');
  const r=await fetch('/api/controller/auth',{
    method:'POST',
    headers:{'Content-Type':'application/json','X-G1-Management-Key':value},
    body:'{}',
    cache:'no-store'
  });
  let body={};try{body=await r.json();}catch{}
  if(!r.ok)throw new Error(body.error||`HTTP ${r.status}`);
  return body;
}
function syncTrustedSessionUi(){
  const authInput=$('controllerManagementKey');
  const authRow=authInput?.closest('.controller-auth-row');

  if(authRow){
    authRow.style.display=trustedSessionActive?'none':'';
  }

  if(trustedSessionActive){
    sessionStorage.removeItem('g1ManagementKey');

    if($('managementKeyModal')){
      $('managementKeyModal').classList.add('hidden');
    }

    if(
      $('controllerModal')?.classList.contains('hidden')
    ){
      document.body.classList.remove('modal-open');
    }

    if(authInput){
      authInput.value='';
    }
  }
}

async function ensureTrustedSession(force=false){

  if(trustedSessionActive&&!force){
    return true;
  }

  if(trustedSessionPromise&&!force){
    return trustedSessionPromise;
  }

  const task=(async()=>{

    const r=await fetch(
      '/api/session/bootstrap',
      {
        method:'POST',

        headers:{
          'Content-Type':'application/json'
        },

        body:'{}',

        cache:'no-store',

        credentials:'same-origin'
      }
    );

    let body={};

    try{
      body=await r.json();
    }catch{}

    if(
      !r.ok
      || body?.trusted_session!==true
    ){
      throw new Error(
        body?.error
        || `trusted session HTTP ${r.status}`
      );
    }

    trustedSessionActive=true;

    syncTrustedSessionUi();

    return true;
  })();

  trustedSessionPromise=task;

  try{
    return await task;
  }finally{
    trustedSessionPromise=null;
  }
}

async function bootstrapManagementKey(){

  try{
    await ensureTrustedSession();
    return;
  }catch(err){

    trustedSessionActive=false;
    syncTrustedSessionUi();

    /*
     * Temporary V14 fallback.
     * Once trusted-session behavior is validated,
     * this entire legacy-key branch will be deleted.
     */
    try{
      const cfg=await loadControllerConfig();

      if(
        !cfg?.enabled
        || !cfg?.management_key_required
      ){
        return;
      }

      const saved=
        sessionStorage.getItem(
          'g1ManagementKey'
        )||'';

      if(saved){
        try{
          await verifyManagementKey(saved);
          return;
        }catch{
          storeManagementKey('');
        }
      }

      showManagementKeyPrompt(
        'Automatic trusted dashboard session failed. Legacy management-key fallback is available for this validation build.'
      );

    }catch(inner){
      console.debug(
        'trusted-session bootstrap unavailable',
        err,
        inner
      );
    }
  }
}

function controllerStateTone(state){
  if(state==='RUNNING') return 'good';
  if(state==='STOPPING'||state==='RUNNING_EXTERNAL') return 'warn';
  if(state==='UNAVAILABLE') return 'bad';
  return null;
}
function controllerStateLabel(state){
  if(state==='RUNNING_EXTERNAL') return 'EXTERNAL';
  return state||'—';
}
function renderControllerProcess(st){
  controllerStatus=st||{};
  const state=controllerStatus.state||'UNAVAILABLE';
  const tone=controllerStateTone(state);
  const ctrlState=String(state||'').toUpperCase();
  const ctrlOnline=[
    'RUNNING',
    'ONLINE',
    'READY',
    'ACTIVE',
    'CONNECTED',
  ].includes(ctrlState);

  setChip(
    $('controllerProcessChip'),
    ctrlOnline ? 'CTRL ONLINE' : 'CTRL OFFLINE',
    ctrlOnline ? 'good' : 'warn',
  );

  /* STITCH_CONTROLLER_SIDEBAR_CHIP_V168
   *
   * Sidebar presentation only.
   *
   * Real /api/controller state remains authoritative:
   *   RUNNING / RUNNING_EXTERNAL -> ONLINE
   *   every other state          -> OFFLINE
   *
   * Header CTRL chip keeps the original detailed state.
   */
  const stitchControllerOnlineV168 =
    state==='RUNNING'
    || state==='RUNNING_EXTERNAL';

  setChip(
    $('controllerProcessState'),
    stitchControllerOnlineV168?'ONLINE':'OFFLINE',
    stitchControllerOnlineV168?'good':'warn'
  );

  if($('controllerProcessState')){
    $('controllerProcessState').title =
      controllerStateLabel(state);
  }
  const pid=controllerStatus.pid;
  $('controllerProcessPid').textContent=pid?`pid ${pid}`:'pid —';
  $('controllerProcessUptime').textContent=finite(controllerStatus.uptime_s)?`uptime ${duration(controllerStatus.uptime_s)}`:'uptime —';
  const inspire=controllerStatus?.dependencies?.inspire||{};
  const inspireState=inspire.state||'—';
  const inspireLabel=inspireState==='RUNNING_MANAGED'?'Inspire MANAGED':inspireState==='RUNNING_EXTERNAL'?'Inspire EXTERNAL':inspireState==='STOPPED'?'Inspire STOPPED':inspireState==='CONFLICT'?'Inspire CONFLICT':inspireState==='UNAVAILABLE'?'Inspire SETUP':'Inspire —';
  $('controllerInspireState').textContent=inspireLabel;
  setTone($('controllerInspireState'),inspireState==='RUNNING_MANAGED'||inspireState==='RUNNING_EXTERNAL'?'good':inspireState==='CONFLICT'?'bad':inspireState==='UNAVAILABLE'?'warn':null);
  let detail='Process manager unavailable.';
  if(state==='STOPPED') detail=inspireState==='RUNNING_EXTERNAL'?'Ready; external Inspire service will be reused and left running on stop.':'Ready; Start launches Inspire first, then the whitelisted teleop listener.';
  else if(state==='RUNNING') detail=inspireState==='RUNNING_MANAGED'?'Listener + dashboard-managed Inspire service are running.':'Dashboard-managed listener is running; Inspire is externally owned.';
  else if(state==='STOPPING') detail='Controlled listener stop requested; Inspire stops only after controller handback/exit.';
  else if(state==='RUNNING_EXTERNAL') detail='Teleop listener is already running outside this dashboard. Lifecycle and XR actions are locked here.';
  else if(controllerStatus.last_error) detail=controllerStatus.last_error;
  else if(inspire.error) detail=`Inspire dependency: ${inspire.error}`;
  else if(controllerStatus.enabled===false) detail='Process actions disabled by dashboard startup configuration.';
  $('controllerProcessDetail').textContent=detail;
  $('controllerConfigureBtn').disabled=controllerActionBusy || state!=='STOPPED' || !controllerStatus.can_start;
  $('controllerConfigureBtn').textContent='Configure';
  if($('controllerSettingsBtn'))$('controllerSettingsBtn').disabled=controllerActionBusy || state!=='STOPPED';
  $('controllerStopBtn').disabled=controllerActionBusy || state!=='RUNNING' || !controllerStatus.can_stop;
  if(state==='STOPPING') $('controllerStopBtn').textContent='Stopping…'; else $('controllerStopBtn').textContent='Stop';
  syncXrActionPairV16();
  if(
    $('controllerStartBtn')
    && !$('controllerModal').classList.contains('hidden')
  ){
    updateControllerStartEnabled();
  }
}
async function pollControllerProcess(){
  if(controllerPollBusy)return; controllerPollBusy=true;
  try{
    const r=await fetch('/api/controller',{cache:'no-store'});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    renderControllerProcess(await r.json());
  }catch(err){
    setChip($('controllerProcessChip'),'CTRL OFFLINE','warn');
    setChip($('controllerProcessState'),'OFFLINE','warn');
    $('controllerProcessDetail').textContent='Controller process manager endpoint unavailable.';
    $('controllerConfigureBtn').disabled=true; $('controllerStopBtn').disabled=true; if($('controllerSettingsBtn'))$('controllerSettingsBtn').disabled=true; if($('bacaEnterTeleopBtn'))$('bacaEnterTeleopBtn').disabled=true; if($('bacaExitTeleopBtn'))$('bacaExitTeleopBtn').disabled=true; if($('controllerSettingsBtn'))$('controllerSettingsBtn').disabled=true;
    console.debug('controller process manager unavailable',err);
  }finally{controllerPollBusy=false;}
}
async function loadControllerConfig(){
  if(controllerConfig)return controllerConfig;
  const r=await fetch('/api/controller/config',{cache:'no-store'});
  if(!r.ok)throw new Error(`controller config HTTP ${r.status}`);
  controllerConfig=await r.json();
  return controllerConfig;
}
function setControllerModalError(message){
  const el=$('controllerModalError');
  if(!message){el.textContent='';el.classList.add('hidden');return;}
  el.textContent=message; el.classList.remove('hidden');
}
function shellPreviewArg(arg){
  const s=String(arg); return /^[A-Za-z0-9_./:=+-]+$/.test(s)?s:`'${s.replaceAll("'","'\\''")}'`;
}
function controllerParamValue(spec){
  const input=$(`controller-param-${spec.name}`);
  if(!input)return spec.default;
  if(spec.type==='bool')return !!input.checked;
  const x=Number(input.value);
  return spec.type==='int'?Math.round(x):x;
}
function controllerModalParameters(){
  const out={};
  for(const spec of controllerConfig?.parameter_specs||[])out[spec.name]=controllerParamValue(spec);
  return out;
}
function updateControllerCommandPreview(){
  if(!controllerConfig)return;
  const cmd=[controllerConfig.controller_python,controllerConfig.controller_script,...(controllerConfig.fixed_args||[])];
  for(const spec of controllerConfig.parameter_specs||[]){
    const value=controllerParamValue(spec);
    if(spec.type==='bool'){if(value)cmd.push(spec.flag);}
    else cmd.push(`${spec.flag}=${value}`);
  }
  $('controllerCommandPreview').textContent=cmd.map(shellPreviewArg).join(' \\\n  ');
}
function setControllerParam(spec,value){
  const input=$(`controller-param-${spec.name}`); if(!input)return;
  if(spec.type==='bool'){input.checked=!!value;return;}
  input.value=String(value);
  const range=$(`controller-range-${spec.name}`); if(range)range.value=String(value);
}
function resetControllerDefaults(){
  if(!controllerConfig)return;
  for(const spec of controllerConfig.parameter_specs||[])setControllerParam(spec,controllerConfig.known_good?.[spec.name]??spec.default);
  updateControllerCommandPreview(); setControllerModalError('');
}
function makeControllerParamRow(spec){
  const row=document.createElement('div');
  row.className=`controller-param-row${spec.type==='bool'?' controller-bool-row':''}`;
  const label=document.createElement('label'); label.textContent=spec.label; label.title=`${spec.flag}${spec.unit?` · ${spec.unit}`:''}`;
  if(spec.type==='bool'){
    const wrap=document.createElement('label'); wrap.className='toggle';
    const input=document.createElement('input'); input.type='checkbox'; input.id=`controller-param-${spec.name}`; input.checked=!!spec.default;
    const text=document.createElement('span'); text.textContent=spec.default?'Enabled':'Disabled';
    input.addEventListener('change',()=>{text.textContent=input.checked?'Enabled':'Disabled';updateControllerCommandPreview();});
    wrap.append(input,text); row.append(label,wrap); return row;
  }
  const range=document.createElement('input'); range.type='range'; range.id=`controller-range-${spec.name}`; range.min=spec.min; range.max=spec.max; range.step=spec.step; range.value=spec.default;
  const numWrap=document.createElement('div'); numWrap.className='controller-param-number';
  const number=document.createElement('input'); number.type='number'; number.id=`controller-param-${spec.name}`; number.min=spec.min; number.max=spec.max; number.step=spec.step; number.value=spec.default;
  const unit=document.createElement('span'); unit.textContent=spec.unit||'';
  const sync=(from,to)=>{to.value=from.value;updateControllerCommandPreview();};
  range.addEventListener('input',()=>sync(range,number)); number.addEventListener('input',()=>sync(number,range));
  numWrap.append(number,unit); row.append(label,range,numWrap); return row;
}
function buildControllerModal(cfg){
  const locked=$('controllerLockedSettings'); locked.innerHTML='';
  for(const item of cfg.locked_settings||[]){const d=document.createElement('div');const a=document.createElement('span');a.textContent=item.label;const b=document.createElement('strong');b.textContent=item.value;b.title=item.value;d.append(a,b);locked.appendChild(d);}
  const sections=$('controllerParameterSections'); sections.innerHTML='';
  const groups=new Map();
  for(const spec of cfg.parameter_specs||[]){if(!groups.has(spec.section))groups.set(spec.section,[]);groups.get(spec.section).push(spec);}
  for(const [name,specs] of groups){
    const section=document.createElement('section');section.className='controller-param-section';
    const head=document.createElement('header');head.textContent=name.toUpperCase();
    const list=document.createElement('div');list.className='controller-param-list';
    for(const spec of specs)list.appendChild(makeControllerParamRow(spec));
    section.append(head,list);sections.appendChild(section);
  }
  $('controllerModalRuntime').textContent=`${cfg.controller_python} · ${cfg.controller_script}`;
  resetControllerDefaults();
}
function updateControllerStartEnabled(){

  const cfg=controllerConfig;

  const ready=
    !!cfg?.enabled
    && !!cfg?.controller_script_exists
    && !!cfg?.controller_hash_match
    && !!cfg?.controller_python_exists
    && controllerStatus?.state==='STOPPED'
    && !controllerActionBusy;

  const button=
    $('controllerStartBtn');

  if(button){
    button.textContent='Save';
    button.disabled=!ready;
  }
}

async function openControllerModal(){

  if(
    controllerStatus?.state!=='STOPPED'
  ){
    return;
  }

  setControllerModalError('');

  $('controllerModal').classList.remove(
    'hidden'
  );

  document.body.classList.add(
    'modal-open'
  );

  try{

    const cfg=
      await loadControllerConfig();

    buildControllerModal(
      cfg
    );

    applySavedControllerParametersV16();

    if(!cfg.enabled){

      setControllerModalError(
        'Controller process actions are disabled.'
      );

    }else if(!cfg.controller_script_exists){

      setControllerModalError(
        `Controller script not found: ${cfg.controller_script}`
      );

    }else if(!cfg.controller_hash_match){

      setControllerModalError(
        `Controller hash mismatch. Expected ${cfg.controller_expected_sha256}; got ${cfg.controller_actual_sha256||'unreadable'}.`
      );

    }else if(!cfg.controller_python_exists){

      setControllerModalError(
        `Controller Python not executable: ${cfg.controller_python}`
      );

    }else if(
      cfg?.inspire_dependency?.state
      === 'CONFLICT'
    ){

      setControllerModalError(
        'Multiple/conflicting Inspire processes detected.'
      );

    }else if(
      cfg?.inspire_dependency?.state
      === 'UNAVAILABLE'
      &&
      !cfg?.inspire_dependency?.helper_installed
    ){

      setControllerModalError(
        'Inspire lifecycle helper is unavailable.'
      );
    }

    updateControllerStartEnabled();

  }catch(err){

    setControllerModalError(
      String(err)
    );

    if($('controllerStartBtn')){
      $('controllerStartBtn').disabled=true;
    }
  }
}

function closeControllerModal(){ $('controllerModal').classList.add('hidden'); document.body.classList.remove('modal-open'); }



/* FULL_DASH_CONTROLLER_UI_V16 */

const controllerSettingsStorageV16 =
  'g1FullDashControllerParametersV16';


function savedControllerParametersV16(){

  try{

    const raw=
      localStorage.getItem(
        controllerSettingsStorageV16
      );

    if(!raw){
      return {};
    }

    const parsed=
      JSON.parse(raw);

    return (
      parsed
      && typeof parsed==='object'
    )
      ? parsed
      : {};

  }catch{
    return {};
  }
}


function normalizeControllerValueV16(
  spec,
  value
){

  if(spec.type==='bool'){
    return !!value;
  }

  const number=
    Number(value);

  if(!Number.isFinite(number)){
    return spec.default;
  }

  if(spec.type==='int'){
    return Math.round(number);
  }

  return number;
}


function launchParametersV16(){

  const cfg=
    controllerConfig;

  const saved=
    savedControllerParametersV16();

  const out={};

  for(
    const spec
    of cfg?.parameter_specs||[]
  ){

    const fallback=
      cfg?.known_good?.[spec.name]
      ?? spec.default;

    const raw=
      Object.prototype.hasOwnProperty.call(
        saved,
        spec.name
      )
        ? saved[spec.name]
        : fallback;

    out[spec.name]=
      normalizeControllerValueV16(
        spec,
        raw
      );
  }

  return out;
}


function applySavedControllerParametersV16(){

  if(!controllerConfig){
    return;
  }

  const saved=
    savedControllerParametersV16();

  for(
    const spec
    of controllerConfig.parameter_specs||[]
  ){

    if(
      Object.prototype.hasOwnProperty.call(
        saved,
        spec.name
      )
    ){

      setControllerParam(
        spec,
        saved[spec.name]
      );
    }
  }

  updateControllerCommandPreview();
}


function saveControllerParametersV16(){

  if(
    !controllerConfig
    || controllerStatus?.state!=='STOPPED'
  ){
    return false;
  }

  const parameters=
    controllerModalParameters();

  localStorage.setItem(
    controllerSettingsStorageV16,
    JSON.stringify(parameters)
  );

  return true;
}


async function quickStartControllerV16(){

  if(
    controllerActionBusy
    || controllerStatus?.state!=='STOPPED'
    || !controllerStatus?.can_start
  ){
    return;
  }


  controllerActionBusy=true;

  renderControllerProcess(
    controllerStatus||{}
  );


  try{

    const cfg=
      await loadControllerConfig();

    if(
      !cfg?.enabled
      || !cfg?.controller_script_exists
      || !cfg?.controller_hash_match
      || !cfg?.controller_python_exists
    ){
      throw new Error(
        'Controller configuration is not launch-ready.'
      );
    }


    await controllerPost(
      '/api/controller/start',
      {
        parameters:
          launchParametersV16()
      }
    );


    await pollControllerProcess();

  }catch(err){

    window.alert(
      `Controller start failed: ${
        err?.message||String(err)
      }`
    );

  }finally{

    controllerActionBusy=false;

    renderControllerProcess(
      controllerStatus||{}
    );
  }
}


function syncXrActionPairV16(){

  const handover=
    latestActionReadiness?.xr_handover
    || {};

  const operation=
    handover.operation
    || 'NONE';

  const available=
    handover.available===true;

  const running=
    controllerStatus?.state==='RUNNING';


  const enter=
    $('bacaEnterTeleopBtn');

  const exit=
    $('bacaExitTeleopBtn');


  if(enter){

    enter.disabled=
      xrActionBusy
      || !running
      || !available
      || operation!=='REQUEST_XR';
  }


  if(exit){

    exit.disabled=
      xrActionBusy
      || !running
      || !available
      || operation!=='HAND_BACK_ARMS';
  }
}


async function runXrActionV16(
  expectedOperation
){

  if(
    xrActionBusy
    || controllerStatus?.state!=='RUNNING'
  ){
    return;
  }


  const handover=
    latestActionReadiness?.xr_handover
    || {};

  if(
    handover.available!==true
    || handover.operation!==expectedOperation
  ){
    return;
  }


  xrActionBusy=true;

  syncXrActionPairV16();


  try{

    const response=
      await requestXrAction(
        expectedOperation
      );

    setXrActionResult(
      `${response.status||'ACCEPTED'} · ${response.reason||expectedOperation}`,
      'good'
    );

  }catch(err){

    const message=
      err?.message
      || String(err);

    setXrActionResult(
      message,
      'warn'
    );

    window.alert(
      `Teleop request failed: ${message}`
    );

  }finally{

    xrActionBusy=false;

    syncXrActionPairV16();
  }
}


async function controllerPost(path,payload={},allowRetry=true){

  if(!trustedSessionActive){
    try{
      await ensureTrustedSession();
    }catch{}
  }

  const legacyKey=
    trustedSessionActive
      ? ''
      : String(
          $('controllerManagementKey')?.value
          || sessionStorage.getItem('g1ManagementKey')
          || ''
        ).trim();

  if(
    !trustedSessionActive
    && !legacyKey
  ){
    throw new Error(
      'Trusted dashboard session is unavailable.'
    );
  }

  const headers={
    'Content-Type':'application/json'
  };

  if(legacyKey){
    headers[
      'X-G1-Management-Key'
    ]=legacyKey;
  }

  let r=await fetch(
    path,
    {
      method:'POST',
      headers,
      body:JSON.stringify(payload),
      credentials:'same-origin'
    }
  );

  /*
   * Bridge restart invalidates its in-memory sessions.
   * Recover transparently once.
   */
  if(
    r.status===401
    && trustedSessionActive
    && allowRetry
  ){
    trustedSessionActive=false;
    syncTrustedSessionUi();

    await ensureTrustedSession(true);

    return controllerPost(
      path,
      payload,
      false
    );
  }

  let body={};

  try{
    body=await r.json();
  }catch{}

  if(r.status===401){
    storeManagementKey('');

    showManagementKeyPrompt(
      'Automatic trusted session was rejected. Legacy fallback is still available in this validation build.'
    );
  }

  if(!r.ok){
    throw new Error(
      body.error
      || `HTTP ${r.status}`
    );
  }

  if(
    legacyKey
    && legacyKey!=='__TRUSTED_SESSION__'
  ){
    storeManagementKey(
      legacyKey
    );
  }

  if(body.controller){
    renderControllerProcess(
      body.controller
    );
  }

  return body;
}

function xrActionButtonLabel(operation){
  if(operation==='REQUEST_XR')return 'ENTER TELEOP';
  if(operation==='CANCEL_XR_REQUEST')return 'CANCEL ENTRY';
  if(operation==='HAND_BACK_ARMS')return 'EXIT TELEOP';
  if(operation==='TRANSITION_IN_PROGRESS')return 'TRANSITIONING…';
  return 'TELEOP ACTION';
}
function setXrActionResult(text,tone=null){
  const el=$('xrActionResult'); if(!el)return;
  el.textContent=text||'';
  el.classList.remove('good','warn');
  if(tone)el.classList.add(tone);
}
async function requestXrAction(operation){

  const body=await controllerPost(
    '/api/controller/action',
    {
      operation
    }
  );

  if(!body?.ok){
    const reason=
      body?.action?.reason
      || body?.error
      || operation;

    throw new Error(
      reason
    );
  }

  return body.action||{};
}

$('managementKeySubmitBtn').addEventListener('click',async()=>{
  if(managementAuthBusy)return;
  managementAuthBusy=true;$('managementKeySubmitBtn').disabled=true;setManagementKeyError('');
  try{
    const key=$('managementKeyInput').value.trim();
    await verifyManagementKey(key);
    storeManagementKey(key);
    const next=managementAfterAuth;
    closeManagementKeyPrompt();
    if(next)setTimeout(next,0);
  }catch(err){setManagementKeyError(err.message||String(err));}
  finally{managementAuthBusy=false;$('managementKeySubmitBtn').disabled=false;}
});
$('managementKeyInput').addEventListener('keydown',(e)=>{if(e.key==='Enter')$('managementKeySubmitBtn').click();});
$('managementKeyReadOnlyBtn').addEventListener('click',()=>closeManagementKeyPrompt());


$('controllerConfigureBtn').addEventListener('click',async()=>{
  await quickStartControllerV16();
});

$('controllerSettingsBtn')?.addEventListener('click',async()=>{
  await openControllerModal();
});

$('bacaEnterTeleopBtn')?.addEventListener('click',async()=>{
  await runXrActionV16('REQUEST_XR');
});

$('bacaExitTeleopBtn')?.addEventListener('click',async()=>{
  await runXrActionV16('HAND_BACK_ARMS');
});

$('controllerModalCloseBtn').addEventListener('click',closeControllerModal);
$('controllerModalCancelBtn').addEventListener('click',closeControllerModal);
$('controllerModal').addEventListener('click',(e)=>{if(e.target===$('controllerModal'))closeControllerModal();});
$('controllerManagementKey').addEventListener('input',()=>storeManagementKey($('controllerManagementKey').value));

$('controllerResetDefaultsBtn').addEventListener('click',resetControllerDefaults);


$('controllerStartBtn').addEventListener('click',()=>{

  if(
    controllerStatus?.state!=='STOPPED'
    || controllerActionBusy
  ){
    return;
  }

  saveControllerParametersV16();

  setControllerModalError('');

  closeControllerModal();
});

$('controllerStopBtn').addEventListener('click',async()=>{
  if(controllerActionBusy)return;
  if(!window.confirm('Request a controlled stop? The controller performs its normal handback first; a dashboard-managed Inspire server is stopped only after the controller exits.'))return;
  controllerActionBusy=true;renderControllerProcess(controllerStatus||{});
  try{await controllerPost('/api/controller/stop',{});await pollControllerProcess();}
  catch(err){window.alert(`Stop request failed: ${err.message||err}`);}
  finally{controllerActionBusy=false;renderControllerProcess(controllerStatus||{});}
});

$('xrActionBtn').addEventListener('click',async()=>{
  if(xrActionBusy)return;
  const handover=latestActionReadiness?.xr_handover||{};
  const operation=handover.operation||'NONE';
  if(!['REQUEST_XR','CANCEL_XR_REQUEST','HAND_BACK_ARMS'].includes(operation))return;
  xrActionBusy=true;
  $('xrActionBtn').disabled=true;
  setXrActionResult(`Sending ${xrActionButtonLabel(operation).toLowerCase()} request…`);
  try{
    const response=await requestXrAction(operation);
    setXrActionResult(`${response.status||'ACCEPTED'} · ${response.reason||operation}`,'good');
  }catch(err){
    setXrActionResult(err.message||String(err),'warn');
  }finally{
    xrActionBusy=false;
    if(latestEnv?.telemetry)renderActionReadiness(latestEnv.telemetry);
    await pollControllerProcess();
  }
});
document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&!$('controllerModal').classList.contains('hidden'))closeControllerModal();});

/* ---------- Camera multiview + teleimager ---------- */
function cameraModeLabel(mode){
  return CAMERA_VIEWS[mode]?.label
    || String(mode||'—').toUpperCase();
}

function fallbackCameraOffer(viewId){
  const view=CAMERA_VIEWS[viewId];
  const host=window.location.hostname;
  if(!host||!view||view.transport!=='webrtc')return null;
  return `https://${host}:${view.port}/offer`;
}

function cameraBaseForView(viewId){
  const offer=fallbackCameraOffer(viewId);
  if(!offer)return null;
  try{
    const url=new URL(offer);
    url.pathname='/';
    url.search='';
    url.hash='';
    return url.toString().replace(/\/$/,'');
  }catch{
    return null;
  }
}


/* ================================================================
   STITCH_CAMERA_MAXIMIZE_V1952

   STITCH_CAMERA_INTERACTION_V1953

   REAL D15-INTEGRATED 2x2 CAMERA WORKSPACE

   NORMAL:
       six ordinary V151 1x1 slots

   EXPANDED:
       one camera = 2x2 / four slots
       up to two ordinary 1x1 cameras remain visible
       extra cameras are REAL V151 parked windows

   Expanded-mode movement uses:
       - V151 green/dotted slot overlay
       - V151 green dock drop target
       - V151 stationary-window jiggle
       - V151 dragged-window styling
       - same 290 ms FLIP easing

   Dock state is real:
       stitchCameraParkedV151

   No 6-slot fullscreen.
   No browser fullscreen.
   No new-tab behavior.
   ================================================================ */


let stitchCameraMaximizeStateV1949 =
    null;


let stitchCameraTransitionBusyV1952 =
    false;


let stitchCameraExpandedPendingV1952 =
    null;


let stitchCameraExpandedDragV1952 =
    null;


let stitchCameraExpandedIconDragV1952 =
    null;


/* ================================================================
   SMALL ARRAY HELPERS
   ================================================================ */

function stitchCameraArrayAddV1952(
    list,
    id
){

    if(
        id
        &&
        !list.includes(id)
    ){
        list.push(id);
    }
}


function stitchCameraArrayRemoveV1952(
    list,
    id
){

    const index =
        list.indexOf(id);


    if(index >= 0){

        list.splice(
            index,
            1
        );
    }
}


/* ================================================================
   CURRENT WORKSPACE SNAPSHOT
   ================================================================ */

function stitchCameraVisibleSnapshotV1949(){

    const stage =
        $('cameraStage');


    if(!stage){
        return [];
    }


    return CAMERA_VIEW_ORDER.filter(
        id => {

            const tile =
                cameraTileElement(
                    id
                );


            return Boolean(
                tile
                &&
                stage.contains(tile)
                &&
                !tile.classList.contains(
                    'hidden'
                )
                &&
                !stitchCameraParkedV151.has(
                    id
                )
            );
        }
    );
}


/* ================================================================
   ICONS
   ================================================================ */

function stitchCameraExpandSvgV1952(){

    return `
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            <path d="M9 4H4v5"/>
            <path d="M4 4l6 6"/>

            <path d="M15 20h5v-5"/>
            <path d="M20 20l-6-6"/>
        </svg>
    `;
}


function stitchCameraRestoreSvgV1952(){

    return `
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            <path d="M4 14h6v6"/>
            <path d="M3 21l7-7"/>

            <path d="M20 10h-6V4"/>
            <path d="M21 3l-7 7"/>
        </svg>
    `;
}


function stitchCameraMaximizeButtonMarkupV1949(
    id
){

    return `
        <button
            type="button"
            class="stitch-camera-maximize-button-v1951"
            data-camera-maximize-v1952="${id}"
            title="Maximize window"
            aria-label="Maximize window"
        >
            <span
                class="stitch-camera-expand-icon-v1951"
                aria-hidden="true"
            >
                ${stitchCameraExpandSvgV1952()}
            </span>

            <span
                class="stitch-camera-restore-icon-v1951"
                aria-hidden="true"
            >
                ${stitchCameraRestoreSvgV1952()}
            </span>
        </button>
    `;
}


/* ================================================================
   MAXIMIZE ICON STATE
   ================================================================ */

function stitchCameraSyncMaximizeControlsV1949(){

    const state =
        stitchCameraMaximizeStateV1949;


    document.querySelectorAll(
        '#view-live [data-camera-maximize-v1952]'
    )
    .forEach(
        button => {

            const id =
                button.dataset
                    .cameraMaximizeV1952;


            const maximized =
                Boolean(
                    state
                    &&
                    state.id === id
                );


            button.classList.toggle(
                'stitch-camera-is-restore-v1951',
                maximized
            );


            button.title =
                maximized
                ?
                'Restore window'
                :
                'Maximize window';


            button.setAttribute(
                'aria-label',
                button.title
            );
        }
    );


    /*
     * The camera owning the current 2x2 card is still ON the
     * workspace. Its top dock icon must remain quiet/gray.
     */

    document.querySelectorAll(
        '#view-live .stitch-camera-dock-btn[data-camera-mode]'
    )
    .forEach(
        button => {

            const owner =
                Boolean(
                    state
                    &&
                    state.id ===
                        button.dataset.cameraMode
                );


            button.classList.toggle(
                'stitch-camera-expanded-owner-v1953',
                owner
            );
        }
    );
}


/* ================================================================
   FRAME WAIT
   ================================================================ */

function stitchCameraNextFrameV1952(){

    return new Promise(
        resolve => {

            requestAnimationFrame(
                ()=>{

                    requestAnimationFrame(
                        resolve
                    );
                }
            );
        }
    );
}


/* ================================================================
   EXPANDED VISIBLE IDS
   ================================================================ */

function stitchCameraExpandedVisibleIdsV1952(){

    const state =
        stitchCameraMaximizeStateV1949;


    if(!state){
        return [];
    }


    return [
        state.id,
        ...state.smallIds.filter(Boolean),
    ]
    .filter(
        id =>
            !stitchCameraParkedV151.has(
                id
            )
    );
}


/* ================================================================
   GEOMETRY CAPTURE
   ================================================================ */

function stitchCameraCaptureRectsV1952(
    ids = null
){

    const before =
        new Map();


    const sourceIds =
        ids
        ||
        stitchCameraExpandedVisibleIdsV1952();


    for(
        const id
        of sourceIds
    ){

        if(!id){
            continue;
        }


        const tile =
            cameraTileElement(
                id
            );


        if(
            !tile
            ||
            tile.classList.contains(
                'hidden'
            )
        ){
            continue;
        }


        before.set(
            tile,
            tile.getBoundingClientRect()
        );
    }


    return before;
}


/* ================================================================
   SAME SETTLING CHARACTER AS V151

       duration 290
       cubic-bezier(0.2, 0.85, 0.25, 1)

   Size changes are included for 1x1 <-> 2x2.
   ================================================================ */

function stitchCameraAnimateRectsV1952(
    before
){

    const animations =
        [];


    for(
        const [
            tile,
            oldRect
        ]
        of before || []
    ){

        if(
            !tile.isConnected
            ||
            tile.classList.contains(
                'hidden'
            )
        ){
            continue;
        }


        const rect =
            tile.getBoundingClientRect();


        if(
            oldRect.width < 1
            ||
            oldRect.height < 1
            ||
            rect.width < 1
            ||
            rect.height < 1
        ){
            continue;
        }


        const dx =
            oldRect.left
            -
            rect.left;


        const dy =
            oldRect.top
            -
            rect.top;


        const sx =
            oldRect.width
            /
            rect.width;


        const sy =
            oldRect.height
            /
            rect.height;


        if(
            Math.abs(dx) < 1
            &&
            Math.abs(dy) < 1
            &&
            Math.abs(sx - 1) < .004
            &&
            Math.abs(sy - 1) < .004
        ){
            continue;
        }


        try{

            animations.push(
                tile.animate(
                    [
                        {
                            transform:
                                `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`
                        },
                        {
                            transform:
                                'translate3d(0,0,0) scale(1)'
                        }
                    ],
                    {
                        duration:
                            290,

                        easing:
                            'cubic-bezier(0.2, 0.85, 0.25, 1)',

                        fill:
                            'both',
                    }
                )
            );

        }
        catch(_){
        }
    }


    if(!animations.length){
        return Promise.resolve();
    }


    return Promise.all(
        animations.map(
            animation =>
                animation.finished
                .catch(
                    ()=>{}
                )
        )
    );
}



/* ================================================================
   STITCH_INTERFACE_CONSISTENCY_V1954

   SMOOTH SHARED-GEOMETRY MAXIMIZE / MINIMIZE

   Deliberately separate from V151's quick 290 ms drag settle.

   Characteristics:
       - 480 ms
       - soft ease-out
       - all affected camera cards animate together
       - position AND size are interpolated
       - finished FLIP transforms are cleaned up
       - no CSS grid snapping animation
       - no timer / observer
   ================================================================ */

function stitchCameraAnimateResizeV1954(
    before
){

    /* ============================================================
       STITCH_D15G_CAMERA_MOTION_V2104

       Exact visual motion transplanted from the standalone
       Bacalbasa D15G_FLUID_MAXIMIZE_RESTORE implementation.

       Integrated camera state/layout ownership is unchanged.
       ============================================================ */

    const running =
        [];


    for(
        const [
            tile,
            oldRect
        ]
        of before || []
    ){

        if(
            !tile
            ||
            !tile.isConnected
            ||
            tile.classList.contains(
                'hidden'
            )
        ){
            continue;
        }


        const newRect =
            tile.getBoundingClientRect();


        if(
            oldRect.width <= 0
            ||
            oldRect.height <= 0
            ||
            newRect.width <= 0
            ||
            newRect.height <= 0
        ){
            continue;
        }


        const dx =
            oldRect.left
            -
            newRect.left;


        const dy =
            oldRect.top
            -
            newRect.top;


        const sx =
            oldRect.width
            /
            newRect.width;


        const sy =
            oldRect.height
            /
            newRect.height;


        if(
            Math.abs(dx) < .5
            &&
            Math.abs(dy) < .5
            &&
            Math.abs(sx - 1) < .002
            &&
            Math.abs(sy - 1) < .002
        ){
            continue;
        }


        /*
         * Clear only old completed presentation transforms.
         * Real grid geometry remains authoritative.
         */

        try{

            for(
                const oldAnimation
                of tile.getAnimations()
            ){

                if(
                    oldAnimation.playState ===
                    'finished'
                ){
                    oldAnimation.cancel();
                }
            }

        }
        catch(_){
        }


        tile.classList.add(
            'stitch-camera-resizing-v1954'
        );


        try{

            const animation =
                tile.animate(
                    [
                        {
                            transformOrigin:
                                'top left',

                            transform:
                                `translate3d(${dx}px, ${dy}px, 0) `
                                +
                                `scale(${sx}, ${sy})`,
                        },

                        {
                            offset:
                                .68,

                            transformOrigin:
                                'top left',

                            transform:
                                'translate3d(0, 0, 0) '
                                +
                                'scale(1.008, 1.008)',
                        },

                        {
                            transformOrigin:
                                'top left',

                            transform:
                                'translate3d(0, 0, 0) '
                                +
                                'scale(1, 1)',
                        },
                    ],
                    {
                        duration:
                            430,

                        easing:
                            'cubic-bezier(.22, 1, .36, 1)',

                        fill:
                            'both',
                    }
                );


            running.push({
                tile,
                animation,
            });

        }
        catch(_){

            tile.classList.remove(
                'stitch-camera-resizing-v1954'
            );
        }
    }


    if(!running.length){
        return Promise.resolve();
    }


    return Promise
        .all(
            running.map(
                entry =>
                    entry.animation.finished
                    .catch(
                        ()=>{}
                    )
            )
        )
        .then(
            ()=>{

                for(
                    const {
                        tile,
                        animation
                    }
                    of running
                ){

                    try{
                        animation.cancel();
                    }
                    catch(_){
                    }


                    tile.classList.remove(
                        'stitch-camera-resizing-v1954'
                    );
                }
            }
        );
}


/* ================================================================
   FADE HELPERS
   ================================================================ */

async function stitchCameraFadeOutV1952(
    ids
){

    const animations =
        [];


    for(
        const id
        of ids
    ){

        const tile =
            cameraTileElement(
                id
            );


        if(
            !tile
            ||
            tile.classList.contains(
                'hidden'
            )
        ){
            continue;
        }


        try{

            animations.push(
                tile.animate(
                    [
                        {
                            opacity:
                                1,

                            transform:
                                'scale(1)'
                        },
                        {
                            opacity:
                                0,

                            transform:
                                'scale(.975)'
                        }
                    ],
                    {
                        duration:
                            150,

                        easing:
                            'ease-out',

                        fill:
                            'both'
                    }
                )
            );

        }
        catch(_){
        }
    }


    await Promise.all(
        animations.map(
            animation =>
                animation.finished
                .catch(
                    ()=>{}
                )
        )
    );


    animations.forEach(
        animation => {

            try{
                animation.cancel();
            }
            catch(_){
            }
        }
    );
}


async function stitchCameraFadeInV1952(
    ids
){

    const animations =
        [];


    for(
        const id
        of ids
    ){

        const tile =
            cameraTileElement(
                id
            );


        if(
            !tile
            ||
            tile.classList.contains(
                'hidden'
            )
        ){
            continue;
        }


        try{

            animations.push(
                tile.animate(
                    [
                        {
                            opacity:
                                0,

                            transform:
                                'scale(.975)'
                        },
                        {
                            opacity:
                                1,

                            transform:
                                'scale(1)'
                        }
                    ],
                    {
                        duration:
                            240,

                        easing:
                            'cubic-bezier(0.2, 0.85, 0.25, 1)'
                    }
                )
            );

        }
        catch(_){
        }
    }


    await Promise.all(
        animations.map(
            animation =>
                animation.finished
                .catch(
                    ()=>{}
                )
        )
    );
}


/* ================================================================
   REAL UI PARKING

   IMPORTANT:
   We intentionally use V151's REAL parked set and parking container.

   We do NOT call toggleCameraView() here because expanding a layout
   should not disconnect/reconnect the underlying feed.
   ================================================================ */

function stitchCameraVisualParkV1952(
    id
){

    const tile =
        stitchCameraTileForIdV151(
            id
        );


    if(
        !tile
        ||
        stitchCameraParkedV151.has(
            id
        )
    ){
        return false;
    }


    stitchCameraParkedV151.add(
        id
    );


    stitchCameraSlotByIdV151.set(
        id,
        null
    );


    tile.classList.add(
        'hidden',
        'stitch-camera-parked-v151'
    );


    tile.style.removeProperty(
        'grid-column'
    );


    tile.style.removeProperty(
        'grid-row'
    );


    stitchCameraEnsureParkingV151()
        .appendChild(
            tile
        );


    stitchCameraSyncDockV151();


    return true;
}


function stitchCameraVisualUnparkV1952(
    id,
    slotIndex = null
){

    const tile =
        stitchCameraTileForIdV151(
            id
        );


    const stage =
        stitchCameraStageV151();


    if(
        !tile
        ||
        !stage
    ){
        return false;
    }


    stitchCameraParkedV151.delete(
        id
    );


    if(
        Number.isInteger(
            slotIndex
        )
    ){

        stitchCameraSlotByIdV151.set(
            id,
            slotIndex
        );
    }


    stage.appendChild(
        tile
    );


    tile.classList.remove(
        'hidden',
        'stitch-camera-parked-v151',
        'stitch-camera-temp-parked-v1949'
    );


    stitchCameraSyncDockV151();


    return true;
}


/* ================================================================
   REPRESENTATIVE V151 SLOT MAP DURING 2x2 MODE

   The visual CSS owns the 2x2 span.

   V151 still receives sensible representative cells:
       large top    -> slot 0
       large bottom -> slot 2

       small row top    -> 0 / 1
       small row bottom -> 4 / 5
   ================================================================ */

function stitchCameraSyncRepresentativeSlotsV1952(){

    const state =
        stitchCameraMaximizeStateV1949;


    if(!state){
        return;
    }


    if(
        !stitchCameraParkedV151.has(
            state.id
        )
    ){

        stitchCameraSlotByIdV151.set(
            state.id,
            state.anchor === 'bottom'
            ?
            2
            :
            0
        );
    }


    const smallSlots =
        state.anchor === 'top'
        ?
        [4,5]
        :
        [0,1];


    state.smallIds.forEach(
        (id,index) => {

            if(
                id
                &&
                !stitchCameraParkedV151.has(
                    id
                )
            ){

                stitchCameraSlotByIdV151.set(
                    id,
                    smallSlots[index]
                );
            }
        }
    );


    for(
        const id
        of state.parkedIds
    ){

        stitchCameraSlotByIdV151.set(
            id,
            null
        );
    }
}


/* ================================================================
   APPLY 2x2 + SMALL ROLES

   Kept under the V1951 function name because renderCameraGrid()
   already invokes this hook.
   ================================================================ */

function stitchCameraApplyExpandedLayoutV1951(){

    const stage =
        $('cameraStage');


    if(!stage){
        return;
    }


    const state =
        stitchCameraMaximizeStateV1949;


    stage.classList.toggle(
        'stitch-camera-expanded-v1951',
        Boolean(state)
    );


    stage.removeAttribute(
        'data-stitch-camera-large-anchor-v1951'
    );


    for(
        const id
        of CAMERA_VIEW_ORDER
    ){

        const tile =
            cameraTileElement(
                id
            );


        if(!tile){
            continue;
        }


        tile.classList.remove(
            'stitch-camera-large-v1951',
            'stitch-camera-small-v1951',
            'stitch-camera-small-left-v1951',
            'stitch-camera-small-right-v1951'
        );
    }


    if(!state){
        return;
    }


    stage.setAttribute(
        'data-stitch-camera-large-anchor-v1951',
        state.anchor
    );


    const large =
        cameraTileElement(
            state.id
        );


    if(
        large
        &&
        !stitchCameraParkedV151.has(
            state.id
        )
    ){

        large.classList.add(
            'stitch-camera-large-v1951'
        );
    }


    state.smallIds.forEach(
        (id,index) => {

            if(
                !id
                ||
                stitchCameraParkedV151.has(
                    id
                )
            ){
                return;
            }


            const tile =
                cameraTileElement(
                    id
                );


            if(!tile){
                return;
            }


            tile.classList.add(
                'stitch-camera-small-v1951',

                index === 0
                ?
                'stitch-camera-small-left-v1951'
                :
                'stitch-camera-small-right-v1951'
            );
        }
    );


    stitchCameraSyncRepresentativeSlotsV1952();

    stitchCameraSyncDockV151();
}


/* ================================================================
   NORMAL -> 2x2

   Windows displaced because the 2x2 needs four cells become REAL
   V151 parked windows, which means their dock icons become green.
   ================================================================ */

async function stitchCameraEnterMaximizeV1949(
    id
){

    id =
        String(
            id || ''
        )
        .toLowerCase();


    if(
        stitchCameraMaximizeStateV1949
        ||
        stitchCameraTransitionBusyV1952
        ||
        !CAMERA_VIEWS[id]
    ){
        return;
    }


    stitchCameraInitializeSlotsV151();


    const snapshot =
        stitchCameraVisibleSnapshotV1949();


    if(
        !snapshot.includes(
            id
        )
    ){
        return;
    }


    const snapshotSlots =
        {};


    for(
        const viewId
        of snapshot
    ){

        snapshotSlots[viewId] =
            stitchCameraSlotByIdV151.get(
                viewId
            );
    }


    const ordered =
        [...snapshot]
        .sort(
            (a,b) => {

                const sa =
                    snapshotSlots[a];

                const sb =
                    snapshotSlots[b];


                return (
                    (
                        Number.isInteger(sa)
                        ?
                        sa
                        :
                        99
                    )
                    -
                    (
                        Number.isInteger(sb)
                        ?
                        sb
                        :
                        99
                    )
                );
            }
        );


    const others =
        ordered.filter(
            value =>
                value !== id
        );


    const smallIds =
        [
            others[0] || null,
            others[1] || null,
        ];


    const autoParkedIds =
        others.slice(
            2
        );


    const originalSlot =
        snapshotSlots[id];


    const originalRow =
        Number.isInteger(
            originalSlot
        )
        ?
        Math.floor(
            originalSlot / 2
        )
        :
        0;


    /*
     * V1.9.54 expansion placement:
     *
     * row 0 -> upper four slots
     * row 1 -> lower four slots
     * row 2 -> lower four slots
     *
     * Therefore a camera starting in either of the lower two
     * rows expands downward instead of jumping to the top.
     */

    const anchor =
        originalRow >= 1
        ?
        'bottom'
        :
        'top';


    const before =
        stitchCameraCaptureRectsV1952(
            snapshot
        );


    stitchCameraTransitionBusyV1952 =
        true;
    /*
     * V2104:
     * standalone Bacalbasa D15G has no pre-layout fade here.
     * The real layout change + FLIP animation owns the motion.
     */


    stitchCameraMaximizeStateV1949 = {

        id,

        snapshot:
            [...snapshot],

        snapshotSlots,

        smallIds,

        /*
         * Current real parked windows created/used by this
         * expanded session.
         */
        parkedIds:
            [...autoParkedIds],

        /*
         * Windows parked automatically ONLY because four slots
         * were needed. These normally return on minimize.
         */
        autoParkedIds:
            [...autoParkedIds],

        /*
         * Explicit workspace -> dock actions performed by user
         * while expanded.
         */
        manualParkedIds:
            [],

        /*
         * Cameras which were already in the dock before maximize
         * but which the user restores while expanded.
         */
        addedIds:
            [],

        anchor,
    };


    for(
        const parkedId
        of autoParkedIds
    ){

        stitchCameraVisualParkV1952(
            parkedId
        );
    }


    renderCameraModes();

    stitchCameraApplyExpandedLayoutV1951();

    stitchCameraSyncMaximizeControlsV1949();


    await stitchCameraNextFrameV1952();


    await stitchCameraAnimateResizeV1954(
        before
    );


    stitchCameraTransitionBusyV1952 =
        false;
}


/* ================================================================
   ASSIGN NORMAL SIX-SLOT LAYOUT ON EXIT
   ================================================================ */

function stitchCameraAssignNormalSlotsV1952(
    state
){

    const manual =
        new Set(
            state.manualParkedIds
        );


    const desired =
        [];


    for(
        const id
        of state.snapshot
    ){

        if(
            !manual.has(id)
        ){

            stitchCameraArrayAddV1952(
                desired,
                id
            );
        }
    }


    for(
        const id
        of state.addedIds
    ){

        if(
            !manual.has(id)
        ){

            stitchCameraArrayAddV1952(
                desired,
                id
            );
        }
    }


    const used =
        new Set();


    const assigned =
        new Set();


    /*
     * Original windows get first chance at their exact pre-maximize
     * slot.
     */

    for(
        const id
        of state.snapshot
    ){

        if(
            !desired.includes(id)
        ){
            continue;
        }


        const slot =
            state.snapshotSlots[id];


        if(
            Number.isInteger(slot)
            &&
            slot >= 0
            &&
            slot < 6
            &&
            !used.has(slot)
        ){

            stitchCameraSlotByIdV151.set(
                id,
                slot
            );


            used.add(
                slot
            );


            assigned.add(
                id
            );
        }
    }


    /*
     * Any extra window restored from the pre-existing dock receives
     * the first remaining free normal slot.
     */

    for(
        const id
        of desired
    ){

        if(
            assigned.has(id)
        ){
            continue;
        }


        let free =
            null;


        for(
            let slot = 0;
            slot < 6;
            slot += 1
        ){

            if(
                !used.has(slot)
            ){

                free =
                    slot;

                break;
            }
        }


        if(
            free === null
        ){
            continue;
        }


        stitchCameraSlotByIdV151.set(
            id,
            free
        );


        used.add(
            free
        );


        assigned.add(
            id
        );
    }
}


/* ================================================================
   2x2 -> NORMAL

   parkLarge=true is used when the user drags the 2x2 window itself
   into the icon bar.
   ================================================================ */


/* ================================================================
   BACALBASA D15G RESTORED-WINDOW MOTION — V2104
   ================================================================ */

function stitchCameraAnimateRestoredWindowsD15GV2104(
    ids,
    activeId = null
){

    const running =
        [];


    let order =
        0;


    for(
        const id
        of ids || []
    ){

        if(
            !id
            ||
            id === activeId
        ){
            continue;
        }


        const tile =
            stitchCameraTileForIdV151(
                id
            );


        if(
            !tile
            ||
            !tile.isConnected
            ||
            tile.classList.contains(
                'hidden'
            )
        ){
            continue;
        }


        try{

            const animation =
                tile.animate(
                    [
                        {
                            opacity:
                                0,

                            transform:
                                'scale(.975)',
                        },

                        {
                            opacity:
                                1,

                            transform:
                                'scale(1)',
                        },
                    ],
                    {
                        duration:
                            280,

                        delay:
                            85
                            +
                            order * 22,

                        easing:
                            'cubic-bezier(.22, 1, .36, 1)',

                        fill:
                            'backwards',
                    }
                );


            running.push(
                animation.finished
                    .catch(
                        ()=>{}
                    )
            );

        }
        catch(_){
        }


        order +=
            1;
    }


    return Promise.all(
        running
    );
}


async function stitchCameraReturnToNormalV1952(
    parkLarge = false,
    beforeOverride = null
){

    const state =
        stitchCameraMaximizeStateV1949;


    if(!state){
        return;
    }


    stitchCameraTransitionBusyV1952 =
        true;


    if(parkLarge){

        stitchCameraArrayAddV1952(
            state.manualParkedIds,
            state.id
        );


        stitchCameraArrayAddV1952(
            state.parkedIds,
            state.id
        );


        stitchCameraVisualParkV1952(
            state.id
        );
    }


    const before =
        beforeOverride
        ||
        stitchCameraCaptureRectsV1952();


    const manual =
        new Set(
            state.manualParkedIds
        );


    const restoredIds =
        [];


    /*
     * Re-open all original windows which were parked automatically,
     * unless the user explicitly parked that window during this
     * expanded session.
     */

    for(
        const id
        of state.snapshot
    ){

        if(
            manual.has(id)
        ){
            continue;
        }


        if(
            stitchCameraParkedV151.has(
                id
            )
        ){

            stitchCameraVisualUnparkV1952(
                id
            );


            restoredIds.push(
                id
            );
        }
    }


    /*
     * Preserve windows that were manually brought in from the dock
     * during expanded mode.
     */

    for(
        const id
        of state.addedIds
    ){

        if(
            manual.has(id)
        ){
            continue;
        }


        if(
            stitchCameraParkedV151.has(
                id
            )
        ){

            stitchCameraVisualUnparkV1952(
                id
            );


            restoredIds.push(
                id
            );
        }
    }


    stitchCameraAssignNormalSlotsV1952(
        state
    );


    /*
     * Explicit manual parks stay in the real V151 dock.
     */

    for(
        const id
        of state.manualParkedIds
    ){

        stitchCameraSlotByIdV151.set(
            id,
            null
        );
    }


    stitchCameraMaximizeStateV1949 =
        null;


    stitchCameraApplyExpandedLayoutV1951();


    renderCameraModes();


    /*
     * Now let V151 itself place normal windows and synchronize
     * the green/quiet dock state.
     */

    stitchCameraApplyLayoutV151();

    stitchCameraSyncMaximizeControlsV1949();


    await stitchCameraNextFrameV1952();


    await Promise.all(
        [
            stitchCameraAnimateResizeV1954(
                before
            ),

            stitchCameraAnimateRestoredWindowsD15GV2104(
                restoredIds,
                state.id
            ),
        ]
    );


    stitchCameraTransitionBusyV1952 =
        false;
}


async function stitchCameraExitMaximizeV1949(){

    if(
        !stitchCameraMaximizeStateV1949
        ||
        stitchCameraTransitionBusyV1952
    ){
        return;
    }


    await stitchCameraReturnToNormalV1952(
        false
    );
}


/* ================================================================
   SMALL -> LARGE PROMOTION
   ================================================================ */

async function stitchCameraPromoteSmallV1952(
    id
){

    const state =
        stitchCameraMaximizeStateV1949;


    if(
        !state
        ||
        stitchCameraTransitionBusyV1952
    ){
        return;
    }


    const index =
        state.smallIds.indexOf(
            id
        );


    if(index < 0){
        return;
    }


    const before =
        stitchCameraCaptureRectsV1952();


    stitchCameraTransitionBusyV1952 =
        true;


    const oldLarge =
        state.id;


    state.id =
        id;


    state.smallIds[index] =
        oldLarge;


    stitchCameraApplyExpandedLayoutV1951();

    stitchCameraSyncMaximizeControlsV1949();


    await stitchCameraNextFrameV1952();


    await stitchCameraAnimateRectsV1952(
        before
    );


    stitchCameraTransitionBusyV1952 =
        false;
}


/* ================================================================
   MAXIMIZE / RESTORE BUTTON
   ================================================================ */

async function stitchCameraToggleMaximizeV1949(
    id
){

    const state =
        stitchCameraMaximizeStateV1949;


    if(!state){

        await stitchCameraEnterMaximizeV1949(
            id
        );

        return;
    }


    if(
        state.id === id
    ){

        await stitchCameraExitMaximizeV1949();

        return;
    }


    if(
        state.smallIds.includes(
            id
        )
    ){

        await stitchCameraPromoteSmallV1952(
            id
        );
    }
}


document.addEventListener(
    'click',
    event => {

        const button =
            event.target.closest(
                '#view-live [data-camera-maximize-v1952]'
            );


        if(!button){
            return;
        }


        event.preventDefault();

        event.stopPropagation();


        stitchCameraToggleMaximizeV1949(
            button.dataset
                .cameraMaximizeV1952
        );
    }
);


/* ================================================================
   EXPANDED LEGAL SLOT OVERLAY

   We intentionally create the REAL V151 overlay first.

   Legal expanded destinations are the two OUTER rows:
       slots 0 / 1
       slots 4 / 5

   The middle row is part of the 2x2 span and is not an independent
   drop destination.

   window mode:
       all four outer targets usable

   restore mode:
       only an empty LEFT/RIGHT small position usable
   ================================================================ */

function stitchCameraConfigureExpandedOverlayV1952(
    overlay,
    mode,
    sourceId = null
){

    const state =
        stitchCameraMaximizeStateV1949;


    if(
        !state
        ||
        !overlay
    ){
        return overlay;
    }


    const largeSource =
        Boolean(
            mode === 'window'
            &&
            sourceId
            &&
            sourceId === state.id
        );


    if(largeSource){

        /*
         * Retire the individual 1x1 guides for the 2x2 card.
         */

        for(
            const slot
            of overlay.slots || []
        ){

            slot.available =
                false;


            slot.element.classList.remove(
                'stitch-camera-slot-available-v151',
                'stitch-camera-expanded-legal-v1952'
            );


            slot.element.classList.add(
                'stitch-camera-slot-unavailable-v151',
                'stitch-camera-slot-hidden-large-v1953'
            );
        }


        const largeTarget =
            document.createElement(
                'div'
            );


        largeTarget.className =
            'stitch-camera-large-target-v1953';


        largeTarget.dataset
            .cameraLargeAnchorV1953 =
                state.anchor || 'top';


        overlay.layer.appendChild(
            largeTarget
        );


        overlay.largeTarget =
            largeTarget;


        return overlay;
    }


    /*
     * Ordinary small-card / dock-restore behavior.
     */

    for(
        const slot
        of overlay.slots || []
    ){

        const row =
            Math.floor(
                slot.index / 2
            );


        const column =
            slot.index % 2;


        let available =
            (
                row === 0
                ||
                row === 2
            );


        if(
            mode === 'restore'
        ){

            available =
                available
                &&
                !state.smallIds[
                    column
                ];
        }


        slot.available =
            available;


        slot.element.classList.toggle(
            'stitch-camera-slot-available-v151',
            available
        );


        slot.element.classList.toggle(
            'stitch-camera-slot-unavailable-v151',
            !available
        );


        slot.element.classList.toggle(
            'stitch-camera-expanded-legal-v1952',
            available
        );
    }


    overlay.largeTarget =
        null;


    return overlay;
}


/* ================================================================
   LARGE 2x2 TARGET POSITION
   ================================================================ */

function stitchCameraLargeAnchorAtPointV1953(
    x,
    y
){

    const stage =
        stitchCameraStageV151();


    if(!stage){
        return null;
    }


    const rect =
        stage.getBoundingClientRect();


    if(
        x < rect.left
        ||
        x > rect.right
        ||
        y < rect.top
        ||
        y > rect.bottom
    ){
        return null;
    }


    return (
        y
        <
        rect.top
        +
        rect.height / 2
    )
    ?
    'top'
    :
    'bottom';
}


function stitchCameraSetLargeTargetV1953(
    target,
    anchor
){

    if(!target){
        return;
    }


    target.classList.toggle(
        'stitch-camera-large-target-active-v1953',
        Boolean(anchor)
    );


    if(anchor){

        target.dataset
            .cameraLargeAnchorV1953 =
                anchor;
    }
}


/* ================================================================
   CLEAN V151 JIGGLE

   Finished FLIP animations can retain transform ownership because
   they use fill:"both". Cancel only FINISHED animations before
   starting the real V151 stationary-window wiggle.
   ================================================================ */

function stitchCameraStartCleanJiggleV1953(
    sourceTile = null
){

    for(
        const id
        of CAMERA_VIEW_ORDER
    ){

        if(
            stitchCameraParkedV151.has(
                id
            )
        ){
            continue;
        }


        const tile =
            stitchCameraTileForIdV151(
                id
            );


        if(!tile){
            continue;
        }


        try{

            for(
                const animation
                of tile.getAnimations()
            ){

                if(
                    animation.playState ===
                    'finished'
                ){

                    animation.cancel();
                }
            }

        }
        catch(_){
        }
    }


    return stitchCameraStartJiggleV151(
        sourceTile
    );
}


/* ================================================================
   POINT IN DOCK
   ================================================================ */

function stitchCameraPointInDockV1952(
    x,
    y
){

    const dock =
        stitchCameraDockV151();


    if(!dock){
        return false;
    }


    const rect =
        dock.getBoundingClientRect();


    return (
        x >= rect.left
        &&
        x <= rect.right
        &&
        y >= rect.top
        &&
        y <= rect.bottom
    );
}


/* ================================================================
   EXPANDED WINDOW DRAG — BEGIN

   This deliberately uses V151's:
       slot layer
       jiggle
       dragging class
       dock highlight
   ================================================================ */

function stitchCameraBeginExpandedWindowV1952(
    pending
){

    const state =
        stitchCameraMaximizeStateV1949;


    if(
        !pending
        ||
        !state
        ||
        stitchCameraExpandedDragV1952
    ){
        return;
    }


    if(
        pending.timer
    ){

        clearTimeout(
            pending.timer
        );
    }


    stitchCameraExpandedPendingV1952 =
        null;


    const overlay =
        stitchCameraConfigureExpandedOverlayV1952(
            stitchCameraCreateSlotLayerV151(
                'window',
                pending.id
            ),
            'window',
            pending.id
        );


    const jiggle =
        stitchCameraStartCleanJiggleV1953(
            pending.tile
        );


    const isLarge =
        pending.id === state.id;


    stitchCameraExpandedDragV1952 = {

        pointerId:
            pending.pointerId,

        tile:
            pending.tile,

        header:
            pending.header,

        id:
            pending.id,

        startX:
            pending.startX,

        startY:
            pending.startY,

        slots:
            overlay.slots,

        largeTarget:
            overlay.largeTarget || null,

        isLarge,

        jiggle,

        targetSlot:
            null,

        targetLargeAnchor:
            isLarge
            ?
            state.anchor
            :
            null,

        targetDock:
            false,
    };


    if(
        isLarge
        &&
        overlay.largeTarget
    ){

        stitchCameraSetLargeTargetV1953(
            overlay.largeTarget,
            state.anchor
        );
    }


    pending.tile.classList.add(
        'stitch-camera-dragging-v151'
    );


    stitchCameraStageV151()
        ?.classList.add(
            'stitch-camera-arranging-v151'
        );


    try{

        pending.header.setPointerCapture(
            pending.pointerId
        );

    }
    catch(_){
    }
}


/* ================================================================
   EXPANDED WINDOW DRAG — MOVE
   ================================================================ */

function stitchCameraMoveExpandedWindowV1952(
    event
){

    const drag =
        stitchCameraExpandedDragV1952;


    if(
        !drag
        ||
        event.pointerId
            !== drag.pointerId
    ){
        return;
    }


    const dx =
        event.clientX
        -
        drag.startX;


    const dy =
        event.clientY
        -
        drag.startY;


    drag.tile.style.setProperty(
        '--stitch-camera-drag-x',
        `${dx}px`
    );


    drag.tile.style.setProperty(
        '--stitch-camera-drag-y',
        `${dy}px`
    );


    const targetDock =
        stitchCameraPointInDockV1952(
            event.clientX,
            event.clientY
        );


    drag.targetDock =
        targetDock;


    stitchCameraDockV151()
        ?.classList.toggle(
            'stitch-camera-dock-drop-v151',
            targetDock
        );


    if(targetDock){

        stitchCameraSetSlotTargetV151(
            drag.slots,
            null,
            false
        );


        stitchCameraSetLargeTargetV1953(
            drag.largeTarget,
            null
        );


        drag.targetSlot =
            null;


        drag.targetLargeAnchor =
            null;
    }

    else if(
        drag.isLarge
    ){

        const anchor =
            stitchCameraLargeAnchorAtPointV1953(
                event.clientX,
                event.clientY
            );


        stitchCameraSetSlotTargetV151(
            drag.slots,
            null,
            false
        );


        stitchCameraSetLargeTargetV1953(
            drag.largeTarget,
            anchor
        );


        drag.targetSlot =
            null;


        drag.targetLargeAnchor =
            anchor;
    }

    else{

        const slot =
            stitchCameraSlotAtPointV151(
                drag.slots,
                event.clientX,
                event.clientY,
                true
            );


        stitchCameraSetSlotTargetV151(
            drag.slots,
            slot,
            false
        );


        drag.targetSlot =
            slot;
    }


    event.preventDefault();

    event.stopImmediatePropagation();
}


/* ================================================================
   CLEAN EXPANDED WINDOW DRAG VISUALS
   ================================================================ */

function stitchCameraCleanupExpandedWindowDragV1952(
    drag,
    pointerId
){

    stitchCameraStopJiggleV151(
        drag.jiggle
    );


    stitchCameraRemoveSlotLayerV151();


    stitchCameraDockV151()
        ?.classList.remove(
            'stitch-camera-dock-drop-v151'
        );


    drag.tile.classList.remove(
        'stitch-camera-dragging-v151'
    );


    drag.tile.style.removeProperty(
        '--stitch-camera-drag-x'
    );


    drag.tile.style.removeProperty(
        '--stitch-camera-drag-y'
    );


    stitchCameraStageV151()
        ?.classList.remove(
            'stitch-camera-arranging-v151'
        );


    try{

        drag.header.releasePointerCapture(
            pointerId
        );

    }
    catch(_){
    }
}


/* ================================================================
   EXPANDED WINDOW DRAG — FINISH
   ================================================================ */

async function stitchCameraFinishExpandedWindowV1952(
    event,
    cancelled = false
){

    const drag =
        stitchCameraExpandedDragV1952;


    if(
        !drag
        ||
        event.pointerId
            !== drag.pointerId
    ){
        return;
    }


    stitchCameraExpandedDragV1952 =
        null;


    const state =
        stitchCameraMaximizeStateV1949;


    if(!state){

        stitchCameraCleanupExpandedWindowDragV1952(
            drag,
            event.pointerId
        );

        return;
    }


    stitchCameraStopJiggleV151(
        drag.jiggle
    );


    drag.jiggle =
        [];


    const before =
        stitchCameraCaptureRectsV1952();


    stitchCameraCleanupExpandedWindowDragV1952(
        drag,
        event.pointerId
    );


    if(cancelled){

        stitchCameraApplyExpandedLayoutV1951();


        await stitchCameraNextFrameV1952();


        await stitchCameraAnimateRectsV1952(
            before
        );


        return;
    }


    /* ============================================================
       DROP INTO ICON BAR
       ============================================================ */

    if(
        drag.targetDock
    ){

        if(
            drag.id ===
                state.id
        ){

            await stitchCameraReturnToNormalV1952(
                true,
                before
            );


            return;
        }


        const smallIndex =
            state.smallIds.indexOf(
                drag.id
            );


        if(
            smallIndex >= 0
        ){

            state.smallIds[
                smallIndex
            ] =
                null;


            stitchCameraArrayAddV1952(
                state.manualParkedIds,
                drag.id
            );


            stitchCameraArrayAddV1952(
                state.parkedIds,
                drag.id
            );


            stitchCameraVisualParkV1952(
                drag.id
            );


            renderCameraModes();


            stitchCameraApplyExpandedLayoutV1951();


            stitchCameraSyncMaximizeControlsV1949();


            await stitchCameraNextFrameV1952();


            await stitchCameraAnimateRectsV1952(
                before
            );
        }


        return;
    }


    /* ============================================================
       LARGE 2x2 -> TOP / BOTTOM
       ============================================================ */

    if(
        drag.isLarge
        &&
        drag.targetLargeAnchor
    ){

        state.anchor =
            drag.targetLargeAnchor;
    }


    /* ============================================================
       SMALL 1x1 -> ORDINARY OUTER SLOT
       ============================================================ */

    else if(
        drag.targetSlot
    ){

        const index =
            drag.targetSlot.index;


        const row =
            Math.floor(
                index / 2
            );


        const column =
            index % 2;


        const oldIndex =
            state.smallIds.indexOf(
                drag.id
            );


        if(
            oldIndex >= 0
        ){

            state.anchor =
                row === 0
                ?
                'bottom'
                :
                'top';


            if(
                oldIndex !== column
            ){

                const other =
                    state.smallIds[
                        column
                    ];


                state.smallIds[
                    column
                ] =
                    drag.id;


                state.smallIds[
                    oldIndex
                ] =
                    other || null;
            }
        }
    }


    stitchCameraApplyExpandedLayoutV1951();


    await stitchCameraNextFrameV1952();


    await stitchCameraAnimateRectsV1952(
        before
    );
}


/* ================================================================
   DOCK ICON -> EXPANDED SMALL SLOT
   ================================================================ */

function stitchCameraBeginExpandedIconV1952(
    event,
    button
){

    const state =
        stitchCameraMaximizeStateV1949;


    if(!state){
        return;
    }


    const id =
        button.dataset.cameraMode;


    if(
        !id
        ||
        !stitchCameraParkedV151.has(
            id
        )
    ){
        return;
    }


    event.preventDefault();

    event.stopImmediatePropagation();


    const overlay =
        stitchCameraConfigureExpandedOverlayV1952(
            stitchCameraCreateSlotLayerV151(
                'restore',
                id
            ),
            'restore',
            id
        );


    const ghost =
        stitchCameraCreateDockGhostV151(
            id
        );


    const jiggle =
        stitchCameraStartCleanJiggleV1953(
            null
        );


    stitchCameraExpandedIconDragV1952 = {

        pointerId:
            event.pointerId,

        id,

        button,

        ghost,

        slots:
            overlay.slots,

        jiggle,

        targetSlot:
            null,
    };


    document.body.classList.add(
        'stitch-camera-d15-restoring-v151'
    );


    stitchCameraPositionDockGhostV151(
        ghost,
        event.clientX,
        event.clientY
    );


    try{

        button.setPointerCapture(
            event.pointerId
        );

    }
    catch(_){
    }
}


function stitchCameraMoveExpandedIconV1952(
    event
){

    const drag =
        stitchCameraExpandedIconDragV1952;


    if(
        !drag
        ||
        event.pointerId
            !== drag.pointerId
    ){
        return;
    }


    event.preventDefault();

    event.stopImmediatePropagation();


    stitchCameraPositionDockGhostV151(
        drag.ghost,
        event.clientX,
        event.clientY
    );


    const slot =
        stitchCameraSlotAtPointV151(
            drag.slots,
            event.clientX,
            event.clientY,
            true
        );


    stitchCameraSetSlotTargetV151(
        drag.slots,
        slot,
        true
    );


    drag.targetSlot =
        slot;
}


async function stitchCameraFinishExpandedIconV1952(
    event
){

    const drag =
        stitchCameraExpandedIconDragV1952;


    if(
        !drag
        ||
        event.pointerId
            !== drag.pointerId
    ){
        return;
    }


    stitchCameraExpandedIconDragV1952 =
        null;


    const state =
        stitchCameraMaximizeStateV1949;


    stitchCameraStopJiggleV151(
        drag.jiggle
    );


    const before =
        stitchCameraCaptureRectsV1952();


    stitchCameraRemoveSlotLayerV151();


    drag.ghost?.remove();


    document.body.classList.remove(
        'stitch-camera-d15-restoring-v151'
    );


    try{

        drag.button.releasePointerCapture(
            event.pointerId
        );

    }
    catch(_){
    }


    if(
        !state
        ||
        !drag.targetSlot
        ||
        !drag.targetSlot.available
    ){
        return;
    }


    const slotIndex =
        drag.targetSlot.index;


    const row =
        Math.floor(
            slotIndex / 2
        );


    const column =
        slotIndex % 2;


    /*
     * This column was marked available only if the corresponding
     * small position is genuinely empty.
     */

    if(
        state.smallIds[
            column
        ]
    ){
        return;
    }


    stitchCameraVisualUnparkV1952(
        drag.id,
        slotIndex
    );


    state.smallIds[
        column
    ] =
        drag.id;


    /*
     * The chosen outer row is the SMALL row.
     */

    state.anchor =
        row === 0
        ?
        'bottom'
        :
        'top';


    stitchCameraArrayRemoveV1952(
        state.parkedIds,
        drag.id
    );


    stitchCameraArrayRemoveV1952(
        state.manualParkedIds,
        drag.id
    );


    if(
        !state.snapshot.includes(
            drag.id
        )
    ){

        stitchCameraArrayAddV1952(
            state.addedIds,
            drag.id
        );
    }


    renderCameraModes();

    stitchCameraApplyExpandedLayoutV1951();

    stitchCameraSyncMaximizeControlsV1949();


    await stitchCameraNextFrameV1952();


    await Promise.all(
        [
            stitchCameraAnimateRectsV1952(
                before
            ),

            stitchCameraFadeInV1952(
                [drag.id]
            ),
        ]
    );
}


/* ================================================================
   EXPANDED INPUT

   Registered before the old V151 input layer because this controller
   appears earlier in app.js. stopImmediatePropagation() therefore
   hands expanded mode to V1952 while NORMAL mode remains V151.
   ================================================================ */

function stitchCameraCancelExpandedPendingV1952(){

    const pending =
        stitchCameraExpandedPendingV1952;


    if(
        pending
        &&
        pending.timer
    ){

        clearTimeout(
            pending.timer
        );
    }


    stitchCameraExpandedPendingV1952 =
        null;
}


document.addEventListener(
    'pointerdown',
    event => {

        const state =
            stitchCameraMaximizeStateV1949;


        if(
            !state
            ||
            event.button !== 0
        ){
            return;
        }


        /*
         * Green dock icon gets the real D15 ghost + restore overlay.
         */

        const dockButton =
            event.target.closest(
                '#view-live .stitch-camera-dock-btn[data-camera-mode]'
            );


        if(
            dockButton
            &&
            stitchCameraParkedV151.has(
                dockButton.dataset.cameraMode
            )
        ){

            stitchCameraBeginExpandedIconV1952(
                event,
                dockButton
            );

            return;
        }


        /*
         * Maximize/minimize button is not a drag handle.
         */

        if(
            event.target.closest(
                '[data-camera-maximize-v1952],'
                +
                'a, button, input, select, label'
            )
        ){
            return;
        }


        const header =
            event.target.closest(
                '#view-live .camera-tile-head'
            );


        if(!header){
            return;
        }


        const tile =
            header.closest(
                '#view-live .camera-tile'
            );


        const id =
            stitchCameraIdV151(
                tile
            );


        if(
            !tile
            ||
            !id
            ||
            (
                id !== state.id
                &&
                !state.smallIds.includes(
                    id
                )
            )
        ){
            return;
        }


        /*
         * Same V151 feel:
         * short 115 ms hold OR >6 px movement begins drag.
         */

        const pending = {

            pointerId:
                event.pointerId,

            tile,

            header,

            id,

            startX:
                event.clientX,

            startY:
                event.clientY,

            timer:
                null,
        };


        pending.timer =
            setTimeout(
                ()=>{

                    if(
                        stitchCameraExpandedPendingV1952
                        === pending
                    ){

                        stitchCameraBeginExpandedWindowV1952(
                            pending
                        );
                    }
                },
                115
            );


        stitchCameraExpandedPendingV1952 =
            pending;


        event.preventDefault();

        event.stopImmediatePropagation();

    },
    true
);


document.addEventListener(
    'pointermove',
    event => {

        if(
            stitchCameraExpandedIconDragV1952
        ){

            stitchCameraMoveExpandedIconV1952(
                event
            );

            return;
        }


        if(
            stitchCameraExpandedDragV1952
        ){

            stitchCameraMoveExpandedWindowV1952(
                event
            );

            return;
        }


        const pending =
            stitchCameraExpandedPendingV1952;


        if(
            !pending
            ||
            event.pointerId
                !== pending.pointerId
        ){
            return;
        }


        const dx =
            event.clientX
            -
            pending.startX;


        const dy =
            event.clientY
            -
            pending.startY;


        if(
            Math.hypot(
                dx,
                dy
            ) > 6
        ){

            stitchCameraBeginExpandedWindowV1952(
                pending
            );


            stitchCameraMoveExpandedWindowV1952(
                event
            );
        }


        event.preventDefault();

        event.stopImmediatePropagation();

    },
    {
        capture:
            true,

        passive:
            false,
    }
);


document.addEventListener(
    'pointerup',
    event => {

        if(
            stitchCameraExpandedIconDragV1952
        ){

            stitchCameraFinishExpandedIconV1952(
                event
            );

            return;
        }


        if(
            stitchCameraExpandedDragV1952
        ){

            stitchCameraFinishExpandedWindowV1952(
                event,
                false
            );

            return;
        }


        const pending =
            stitchCameraExpandedPendingV1952;


        if(
            pending
            &&
            event.pointerId
                === pending.pointerId
        ){

            stitchCameraCancelExpandedPendingV1952();

            event.stopImmediatePropagation();
        }

    },
    true
);


document.addEventListener(
    'pointercancel',
    event => {

        if(
            stitchCameraExpandedIconDragV1952
        ){

            stitchCameraFinishExpandedIconV1952(
                event
            );

            return;
        }


        if(
            stitchCameraExpandedDragV1952
        ){

            stitchCameraFinishExpandedWindowV1952(
                event,
                true
            );

            return;
        }


        stitchCameraCancelExpandedPendingV1952();

    },
    true
);


/* ================================================================
   ESCAPE = RESTORE ORDINARY WORKSPACE
   ================================================================ */

document.addEventListener(
    'keydown',
    event => {

        if(
            event.key === 'Escape'
            &&
            stitchCameraMaximizeStateV1949
            &&
            !stitchCameraTransitionBusyV1952
        ){

            stitchCameraExitMaximizeV1949();
        }
    }
);



function ensureCameraTiles(){
  const stage=$('cameraStage');
  if(!stage||stage.dataset.initialized==='true')return;

  stage.dataset.initialized='true';
  stage.innerHTML=CAMERA_VIEW_ORDER.map(id=>{
    const view=CAMERA_VIEWS[id];
    const media=view.transport==='webgl'
      ?'<canvas id="pointCloudCanvas" class="pointcloud-canvas" aria-label="Interactive camera-relative 3-D point cloud"></canvas>'
      :`<video data-camera-video="${id}" autoplay playsinline muted></video>`;

    /* V1.9.49: old per-tile _blank/CERT control removed. */
    const maximize=
      stitchCameraMaximizeButtonMarkupV1949(id);

    return `
      <article class="camera-tile hidden" data-camera-view-tile="${id}">
        <div class="camera-tile-head">
          <!-- STITCH_CAMERA_HEADER_RENDER_V153 -->
          <div class="stitch-camera-title-v147">
            <span class="stitch-camera-title-icon-v147">
              ${stitchCameraIconV147(id)}
            </span>
            <strong>${view.label}</strong>
          </div>
          <div class="stitch-camera-tile-actions-v1949">
            <span class="camera-tile-state" data-camera-state="${id}">OFFLINE</span>
            ${maximize}
          </div>
        </div>
        <div class="camera-tile-body">
          ${media}
          <div class="camera-tile-overlay" data-camera-overlay="${id}">
            <div class="camera-overlay-icon">◉</div>
            <strong data-camera-overlay-title="${id}">Not connected</strong>
            <span data-camera-overlay-text="${id}">Waiting for camera connection.</span>
          </div>
        </div>
      </article>`;
  }).join('');
}

ensureCameraTiles();

function cameraTileElement(id){
  return document.querySelector(
    `[data-camera-view-tile="${id}"]`
  );
}

function cameraVideoElement(id){
  return document.querySelector(
    `[data-camera-video="${id}"]`
  );
}

function setCameraTileState(
  id,
  state,
  detail='',
  tone=null,
){
  const tile=cameraTileElement(id);
  if(!tile)return;

  const stateElement=tile.querySelector(
    `[data-camera-state="${id}"]`
  );
  const overlay=tile.querySelector(
    `[data-camera-overlay="${id}"]`
  );
  const title=tile.querySelector(
    `[data-camera-overlay-title="${id}"]`
  );
  const text=tile.querySelector(
    `[data-camera-overlay-text="${id}"]`
  );

  if(stateElement){
    stateElement.textContent=state;
    stateElement.className=
      `camera-tile-state${tone?` ${tone}`:''}`;
  }

  if(title)title.textContent=state;
  if(text&&detail)text.textContent=detail;
  if(overlay)overlay.classList.toggle('hidden',state==='LIVE');
}

function pointCloudActive(){
  if(!activeCameraViews.includes('pointcloud')){
    return false;
  }

  /*
   * The point-cloud HTTP endpoint is the source of truth.
   * Do not require one exact camera-process state string here.
   * Only suppress polling for states that definitely mean the
   * camera backend is unavailable.
   */
  const state=String(
    cameraProcessStatus?.state||''
  ).toUpperCase();

  return ![
    'STOPPED',
    'STOPPING',
    'OFFLINE',
    'ERROR',
    'FAILED',
  ].includes(state);
}

function syncCameraConnectionState(){
  const first=Array.from(cameraPeers.values())
    .find(entry=>entry?.pc);

  cameraPc=first?.pc
    || (
      pointCloudActive()
        ?{connectionState:'connected'}
        :null
    );

  cameraConnecting=cameraPeerConnecting.size>0;
}

function closeCameraPeer(id,{resetState=true}={}){
  const entry=cameraPeers.get(id);

  if(entry){
    if(entry.frameWatch)clearTimeout(entry.frameWatch);
    try{entry.pc?.close();}catch{}

    const video=cameraVideoElement(id);
    if(video){
      try{
        if(video.srcObject){
          video.srcObject.getTracks().forEach(
            track=>track.stop()
          );
        }
      }catch{}
      video.srcObject=null;
    }

    cameraPeers.delete(id);
  }

  cameraPeerConnecting.delete(id);

  if(resetState&&activeCameraViews.includes(id)){
    setCameraTileState(
      id,
      'READY',
      'Press Connect views.',
    );
  }

  syncCameraConnectionState();
}

function cameraProcessTone(state){
  if(state==='RUNNING'||state==='RUNNING_EXTERNAL')return 'good';
  if(state==='STOPPING')return 'warn';
  if(state==='CONFLICT'||state==='UNAVAILABLE')return 'bad';
  return null;
}

function allActiveVideoViewsConnected(){
  const ids=activeWebRtcViews();
  if(!ids.length)return true;

  return ids.every(id=>{
    const entry=cameraPeers.get(id);
    return entry?.pc?.connectionState==='connected';
  });
}

function renderCameraGrid(){
  ensureCameraTiles();

  const stage=$('cameraStage');
  if(!stage)return;

  const activeSet=new Set(activeCameraViews);

  const maximizeStateV1949=
    stitchCameraMaximizeStateV1949;

  /*
   * V1.9.51:
   * retire both V1949's whole-stage maximize class and
   * V1950's four/six phase classes.
   *
   * Expanded mode stays a REAL 2x3 six-slot grid.
   */

  stage.classList.remove(
    'stitch-camera-maximized-v1949',
    'stitch-camera-four-v1950',
    'stitch-camera-six-v1950'
  );

  stage.classList.toggle(
    'stitch-camera-expanded-v1951',
    Boolean(maximizeStateV1949)
  );

  document.body.classList.remove(
    'stitch-camera-workspace-maximized-v1949'
  );

  stage.dataset.count=
    maximizeStateV1949
      ?'6'
      :String(
          Math.max(
            1,
            Math.min(
              9,
              activeCameraViews.length
            )
          )
        );

  stitchCameraSyncMaximizeControlsV1949();

  stitchCameraApplyExpandedLayoutV1951();

  for(const id of CAMERA_VIEW_ORDER){
    const tile=cameraTileElement(id);
    if(!tile)continue;

    const active=activeSet.has(id);

    const maximizedV1949=
      Boolean(
        maximizeStateV1949
        &&
        maximizeStateV1949.id===id
      );

    const temporarilyParkedV1949=
      Boolean(
        maximizeStateV1949
        &&
        Array.isArray(
          maximizeStateV1949.parkedIds
        )
        &&
        maximizeStateV1949.parkedIds.includes(
          id
        )
      );

    /*
     * Preserve the REAL active camera state.
     * Maximize is only a workspace presentation state.
     */

    tile.classList.toggle(
      'hidden',
      !active
    );

    tile.classList.toggle(
      'stitch-camera-maximized-tile-v1949',
      maximizedV1949
    );

    tile.classList.toggle(
      'stitch-camera-temp-parked-v1949',
      temporarilyParkedV1949
    );

    if(!active)continue;

    if(id==='pointcloud'){
      if(pointCloudActive()){
        const stats=PointCloud3D.getStats?.()||{};
        if(!stats.points){
          setCameraTileState(
            id,
            'WAITING',
            'Waiting for a point-cloud snapshot.',
            'warn',
          );
        }
      }else{
        setCameraTileState(
          id,
          'OFFLINE',
          'Start the managed camera server.',
        );
      }
      continue;
    }

    const entry=cameraPeers.get(id);
    if(entry?.pc?.connectionState==='connected'){
      setCameraTileState(id,'LIVE','', 'good');
      continue;
    }

    if(cameraPeerConnecting.has(id)){
      setCameraTileState(
        id,
        'CONNECTING',
        `Negotiating ${cameraModeLabel(id)} WebRTC.`,
        'warn',
      );
      continue;
    }

    const viewStatus=cameraViewProcessStatus(id);
    if(
      cameraProcessStatus?.state==='RUNNING'
      && viewStatus?.port_ready
    ){
      setCameraTileState(
        id,
        'READY',
        'Press Connect views.',
      );
    }else if(cameraProcessStatus?.state==='RUNNING'){
      setCameraTileState(
        id,
        'STARTING',
        'The selected publisher is starting.',
        'warn',
      );
    }else{
      setCameraTileState(
        id,
        'OFFLINE',
        'Start the managed camera server.',
      );
    }
  }





  stitchCameraRefreshV147();


  if(
    typeof stitchCameraDockSyncV151
    === 'function'
  ){
    stitchCameraDockSyncV151();
  }
}

/* STITCH_CAMERA_CONTROLS_V158 */
let stitchCameraLocalPowerV158=false;

function renderCameraProcess(st){
  cameraProcessStatus=st||{};

  if(Array.isArray(cameraProcessStatus.web_views_requested)){
    activeCameraViews=normalizeCameraViews(
      cameraProcessStatus.web_views_requested
    );
  }

  for(const id of Array.from(cameraPeers.keys())){
    if(!activeCameraViews.includes(id)){
      closeCameraPeer(id,{resetState:false});
    }
  }

  const state=cameraProcessStatus.state||'UNAVAILABLE';
  const badge=$('cameraProcessState');
  const text=
    state==='RUNNING'?'SERVER ON':
    state==='RUNNING_EXTERNAL'?'SERVER EXT':
    state==='STOPPED'?'SERVER OFF':
    state==='STOPPING'?'SERVER STOPPING':
    state==='CONFLICT'?'SERVER CONFLICT':
    'SERVER SETUP';

  badge.textContent=text;
  badge.className=
    `camera-process-state${
      cameraProcessTone(state)
        ?` ${cameraProcessTone(state)}`
        :''
    }`;

  const connect=$('cameraConnectBtn');
  const stop=$('cameraStopBtn');
  const powerSwitch=$('stitchCameraPowerSwitchV158');
  const preview=stitchCameraUiPreviewV142();

  /*
   * V1.5.8:
   * Both halves stay physically present, like the Bacalbasa
   * Start / Stop control.
   *
   * Real handlers are unchanged.
   */
  /* STITCH_CAMERA_LABELS_V163
   * Presentation labels only.
   *
   * Button IDs and their original Dragos handlers stay unchanged:
   *   cameraConnectBtn -> startAndConnectCamera()
   *   cameraStopBtn    -> stopCameraButton()
   */
  connect.textContent='Connect';
  stop.textContent='Disconnect';

  connect.classList.remove('hidden');
  stop.classList.remove('hidden');

  const cameraOn=
    preview
      ?stitchCameraLocalPowerV158
      :(
          state==='RUNNING'
          || state==='RUNNING_EXTERNAL'
        );

  powerSwitch?.classList.toggle(
    'camera-on',
    cameraOn
  );

  powerSwitch?.classList.toggle(
    'camera-off',
    !cameraOn
  );

  connect.setAttribute(
    'aria-pressed',
    cameraOn?'false':'true'
  );

  stop.setAttribute(
    'aria-pressed',
    cameraOn?'true':'false'
  );

  if(preview){
    connect.disabled=stitchCameraLocalPowerV158;
    stop.disabled=!stitchCameraLocalPowerV158;
  }else{
    stop.disabled=(
      cameraProcessActionBusy
      ||
      !(
        state==='RUNNING'
        ||
        (
          state==='RUNNING_EXTERNAL'
          && cameraPeers.size>0
        )
      )
    );
  }

  renderCameraModes();
  updateCameraButtons(latestEnv?.telemetry||{});
  syncCameraConnectionState();
}

async function pollCameraProcess(){
  if(cameraProcessPollBusy)return cameraProcessStatus;
  cameraProcessPollBusy=true;

  try{
    const response=await fetch(
      '/api/camera',
      {cache:'no-store'}
    );

    if(!response.ok){
      throw new Error(`HTTP ${response.status}`);
    }

    const status=await response.json();
    renderCameraProcess(status);
    return status;
  }catch(error){
    cameraProcessStatus={
      state:'UNAVAILABLE',
      can_start:false,
      can_stop:false,
      last_error:String(error),
    };
    renderCameraProcess(cameraProcessStatus);
    console.debug(
      'camera process endpoint unavailable',
      error,
    );
    return cameraProcessStatus;
  }finally{
    cameraProcessPollBusy=false;
  }
}

async function cameraProcessPost(path,payload={}){
  const key=currentManagementKey();

  if(!key){
    throw new Error('Enter the management key first.');
  }

  const response=await fetch(path,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'X-G1-Management-Key':key,
    },
    body:JSON.stringify(payload||{}),
  });

  let body={};
  try{body=await response.json();}catch{}

  if(response.status===401){
    storeManagementKey('');
    showManagementKeyPrompt(
      'Management key rejected. Enter the key printed by the currently running ./start_dashboard.sh.'
    );
  }

  if(!response.ok){
    throw new Error(body.error||`HTTP ${response.status}`);
  }

  if(body.camera)renderCameraProcess(body.camera);
  return body.camera||cameraProcessStatus;
}


/* ================================================================
   STITCH_CAMERA_WINDOWS_V142

   Local UI-development fallback only.

   The secondary-PC static preview has no camera-management backend,
   so its camera view selector is allowed to manipulate the existing
   frontend view model locally.

   Real dashboard instances continue through the original backend
   path unchanged.
   ================================================================ */

function stitchCameraUiPreviewV142() {
  return (
    (
      window.location.hostname === '127.0.0.1'
      ||
      window.location.hostname === 'localhost'
    )
    &&
    window.location.port === '8081'
  );
}


/* STITCH_CAMERA_CONTROLS_V157
   Local 8081 preview state only.
   Real dashboard YOLO behavior remains backend-controlled.
*/
let stitchCameraLocalYoloV157=false;


function renderCameraModes(){
  const status=cameraProcessStatus||{};
  const requested=normalizeCameraViews(
    status.web_views_requested||activeCameraViews
  );
  const actual=Array.isArray(status.web_views_actual)
    ?normalizeCameraViews(status.web_views_actual)
    :null;
  const controllable=(
    status.state==='RUNNING'
    && status.web_views_control
  );

  activeCameraViews=requested;

  /*
   * If the selected source disappears externally while maximized,
   * gracefully abandon maximize rather than displaying stale state.
   */

  if(
    stitchCameraMaximizeStateV1949
    &&
    !requested.includes(
      stitchCameraMaximizeStateV1949.id
    )
  ){
    stitchCameraMaximizeStateV1949=null;

    document.body.classList.remove(
      'stitch-camera-workspace-maximized-v1949'
    );
  }

  const activeSet=new Set(requested);

  const maximizeStateV1949=
    stitchCameraMaximizeStateV1949;

  document.querySelectorAll(
    '[data-camera-mode]'
  ).forEach(button=>{
    const id=button.dataset.cameraMode;

    const requestedActive=
      activeSet.has(id);

    const temporarilyParkedV1949=
      Boolean(
        maximizeStateV1949
        &&
        Array.isArray(
          maximizeStateV1949.parkedIds
        )
        &&
        maximizeStateV1949.parkedIds.includes(
          id
        )
      );

    /*
     * Only windows displaced by THIS maximize operation look
     * temporarily closed in the icon bar.
     *
     * Anything that was already parked beforehand is untouched.
     */

    const active=
      temporarilyParkedV1949
        ?false
        :requestedActive;

    button.classList.toggle(
      'active',
      active
    );

    button.classList.toggle(
      'stitch-camera-temp-parked-button-v1949',
      temporarilyParkedV1949
    );
    button.setAttribute(
      'aria-pressed',
      active?'true':'false',
    );
    button.disabled=(
      !controllable
      || cameraViewsActionBusy
    );
    button.title=controllable
      ?`${active?'Hide':'Show'} ${cameraModeLabel(id)}.`
      :'Start the dashboard-managed camera server first.';
  });

  const waiting=(
    controllable
    && (
      !actual
      || actual.join('|')!==requested.join('|')
    )
  );

  const badge=$('cameraModeState');
  badge.textContent=cameraViewsActionBusy||waiting
    ?`VIEWS ${requested.length}…`
    :`VIEWS ${requested.length}`;
  badge.className=
    `camera-mode-state${waiting?' warn':' good'}`;

  const yoloToggle=$('cameraYoloToggle');
  const yoloControl=$('cameraYoloControl');
  const yoloBadge=$('cameraYoloState');
  const yoloPreview=
    stitchCameraUiPreviewV142();

  const yoloRequested=
    yoloPreview
      ?stitchCameraLocalYoloV157
      :!!status.yolo_requested;

    const yoloControllable=(
    yoloPreview
    || [
      'RUNNING',
      'RUNNING_EXTERNAL',
    ].includes(
      String(status.state||'').toUpperCase()
    )
  );

  const yoloWaiting=(
    !yoloPreview
    &&
    yoloControllable
    && (
      !status.yolo_ack_online
      || status.yolo_actual!==yoloRequested
    )
  );

  yoloControl?.classList.toggle(
    'active',
    yoloRequested,
  );
  yoloControl?.classList.toggle(
    'busy',
    cameraYoloActionBusy||yoloWaiting,
  );

  if(yoloToggle){
    yoloToggle.checked=yoloRequested;
    yoloToggle.indeterminate=yoloWaiting;
    yoloToggle.disabled=(
      !yoloControllable
      || cameraYoloActionBusy
    );
  }

  if(yoloBadge){
    yoloBadge.textContent=yoloWaiting
      ?`YOLO ${yoloRequested?'ON':'OFF'}…`
      :`YOLO ${yoloRequested?'ON':'OFF'}`;
    yoloBadge.className=
      `camera-yolo-state${
        yoloWaiting
          ?' warn'
          :yoloRequested
            ?' good'
            :''
      }`;
  }

  renderCameraGrid();
  syncPointCloudRuntime();
  renderCameraSourceMetadata(latestEnv?.telemetry||{});


  /*
   * UI-only preview:
   * these are presentation window toggles here, not backend actions.
   */
  if(stitchCameraUiPreviewV142()){
    document
      .querySelectorAll('[data-camera-mode]')
      .forEach(button=>{
        button.disabled=false;

        const id=button.dataset.cameraMode;
        const active=
          activeCameraViews.includes(id);

        button.title=
          `${active?'Hide':'Show'} ${cameraModeLabel(id)}.`;
      });
  }
}

async function toggleCameraView(id){

  if(stitchCameraUiPreviewV142()){
    if(
      !CAMERA_VIEWS[id]
      ||
      cameraViewsActionBusy
    ){
      return;
    }

    const wasActive=
      activeCameraViews.includes(id);

    /*
     * Preserve the real dashboard's existing invariant:
     * never remove the final visible camera view.
     */
    if(
      wasActive
      &&
      activeCameraViews.length === 1
    ){
      return;
    }

    const next=
      wasActive
        ? activeCameraViews.filter(
            value=>value!==id
          )
        : [
            ...activeCameraViews,
            id
          ];

    activeCameraViews=
      normalizeCameraViews(next);

    renderCameraGrid();
    renderCameraModes();
    renderCameraSourceMetadata(
      latestEnv?.telemetry || {}
    );

    return;
  }


  id=String(id||'').toLowerCase();
  if(!CAMERA_VIEWS[id]||cameraViewsActionBusy)return;

  if(!currentManagementKey()){
    showManagementKeyPrompt(
      'Enter the management key to change active camera views.',
      ()=>toggleCameraView(id),
    );
    return;
  }

  if(
    cameraProcessStatus?.state!=='RUNNING'
    || !cameraProcessStatus?.web_views_control
  ){
    window.alert(
      'Start the dashboard-managed camera server before changing views.'
    );
    return;
  }

  const wasActive=activeCameraViews.includes(id);
  let next=wasActive
    ?activeCameraViews.filter(value=>value!==id)
    :[...activeCameraViews,id];

  next=normalizeCameraViews(next);

  if(wasActive&&activeCameraViews.length===1){
    window.alert(
      'At least one camera view must remain active.'
    );
    return;
  }

  const reconnect=(
    cameraPeers.size>0
    || pointCloudActive()
  );

  cameraViewsActionBusy=true;
  renderCameraModes();

  try{
    const status=await cameraProcessPost(
      '/api/camera/views',
      {views:next},
    );

    if(status)renderCameraProcess(status);

    if(wasActive){
      closeCameraPeer(id,{resetState:false});
    }else if(
      reconnect
      && CAMERA_VIEWS[id].transport==='webrtc'
    ){
      await waitCameraViewReady(id);
      await connectCameraView(id);
    }

    if(id==='pointcloud'){
      syncPointCloudRuntime();
    }
  }catch(error){
    window.alert(
      `Camera view update failed: ${
        error.message||error
      }`
    );
  }finally{
    cameraViewsActionBusy=false;
    await pollCameraProcess();
    renderCameraModes();
  }
}

const POINT_VIEW_DEFAULT={
  yaw_deg:22,
  pitch_deg:14,
  distance_m:3.16,
  target_z_m:2.0,
};

function pointClamp(value,minimum,maximum){
  return Math.max(
    minimum,
    Math.min(maximum,Number(value)),
  );
}

function normalizePointView(raw={}){
  return {
    yaw_deg:pointClamp(
      finite(raw.yaw_deg)
        ?raw.yaw_deg
        :POINT_VIEW_DEFAULT.yaw_deg,
      -180,
      180,
    ),
    pitch_deg:pointClamp(
      finite(raw.pitch_deg)
        ?raw.pitch_deg
        :POINT_VIEW_DEFAULT.pitch_deg,
      -82,
      82,
    ),
    distance_m:pointClamp(
      finite(raw.distance_m)
        ?raw.distance_m
        :POINT_VIEW_DEFAULT.distance_m,
      1,
      8,
    ),
    target_z_m:pointClamp(
      finite(raw.target_z_m)
        ?raw.target_z_m
        :POINT_VIEW_DEFAULT.target_z_m,
      .5,
      5,
    ),
  };
}

function currentPointView(){
  return normalizePointView(
    PointCloud3D.getView?.()
    || pointViewLocal
    || POINT_VIEW_DEFAULT
  );
}

async function syncPointViewToCamera(view){
  if(
    pointViewSendBusy
    || !currentManagementKey()
    || cameraProcessStatus?.state!=='RUNNING'
    || !cameraProcessStatus?.point_view_control
  )return;

  pointViewSendBusy=true;

  try{
    const status=await cameraProcessPost(
      '/api/camera/view',
      {view:normalizePointView(view)},
    );
    if(status)cameraProcessStatus=status;
  }catch(error){
    console.warn(
      'point-view synchronization failed',
      error,
    );
  }finally{
    pointViewSendBusy=false;
    syncPointCloudRuntime();
  }
}

const pointCloudViewer=PointCloud3D.init(
  $('pointCloudCanvas'),
  (view,final)=>{
    pointViewLocal=normalizePointView(view);
    syncPointCloudRuntime();

    if(final){
      syncPointViewToCamera(pointViewLocal);
    }
  },
);

PointCloud3D.setView(
  POINT_VIEW_DEFAULT,
  false,
);


function syncPointCloudRuntime(){
  const show=pointCloudActive();

  PointCloud3D.setVisible(show);

  if(show&&!pointViewInitialized){
    const initial=normalizePointView(
      cameraProcessStatus?.point_view_actual
      || cameraProcessStatus?.point_view_requested
      || POINT_VIEW_DEFAULT
    );
    PointCloud3D.setView(initial,false);
    pointViewInitialized=true;
  }

  if(!show){
    pointViewInitialized=false;
    if(pointCloudPollTimer){
      clearTimeout(pointCloudPollTimer);
      pointCloudPollTimer=null;
    }
  }

  if(show)ensurePointCloudPoll();
  syncCameraConnectionState();
}

/* FULL_DASH_POINTCLOUD_BROWSER_BUDGET_V21_5B
 *
 * Camera backend remains unchanged.
 *
 * The endpoint is latest-only, so the browser does not need to
 * download/decode/upload the same 30 Hz production rate.
 *
 * Keep robot pose polling/rendering responsive by sampling the newest
 * point cloud at 8 Hz.
 */
const POINT_CLOUD_BROWSER_POLL_MS=125;

async function pollPointCloud(){
  pointCloudPollTimer=null;

  if(!pointCloudActive())return;

  if(pointCloudFetchBusy){
    ensurePointCloudPoll();
    return;
  }

  pointCloudFetchBusy=true;
  const pointCloudPollStarted=performance.now();

  try{
    const response=await fetch(
      '/api/camera/pointcloud',
      {cache:'no-store'},
    );

    if(response.ok&&response.status!==204){
      const snapshot=await response.arrayBuffer();
      PointCloud3D.setSnapshot(snapshot);
      setCameraTileState(
        'pointcloud',
        'LIVE',
        '',
        'good',
      );
      cameraState('LIVE','good');
    }
  }catch(error){
    console.debug(
      'point-cloud snapshot unavailable',
      error,
    );
    setCameraTileState(
      'pointcloud',
      'WAITING',
      'Point-cloud snapshot unavailable.',
      'warn',
    );
  }finally{
    pointCloudFetchBusy=false;

    if(pointCloudActive()){
      pointCloudPollTimer=setTimeout(
        pollPointCloud,
        Math.max(
          0,
          POINT_CLOUD_BROWSER_POLL_MS
            - (performance.now()-pointCloudPollStarted),
        ),
      );
    }
  }
}

function ensurePointCloudPoll(){
  if(
    !pointCloudActive()
    || pointCloudPollTimer
    || pointCloudFetchBusy
  )return;

  pointCloudPollTimer=setTimeout(
    pollPointCloud,
    0,
  );
}



async function setCameraYolo(enabled){
  enabled=!!enabled;

  if(cameraYoloActionBusy)return;

  /*
   * Preserve static UI-preview behavior.
   */
  if(stitchCameraUiPreviewV142()){
    stitchCameraLocalYoloV157=enabled;
    renderCameraModes();
    return;
  }

  const state=String(
    cameraProcessStatus?.state||''
  ).toUpperCase();

  if(![
    'RUNNING',
    'RUNNING_EXTERNAL',
  ].includes(state)){
    renderCameraModes();

    window.alert(
      'YOLO is available only while the camera server is running.'
    );

    return;
  }

  /*
   * Optimistically adopt the requested state.
   * The normal backend poll corrects it if the request fails.
   */
  cameraProcessStatus={
    ...(cameraProcessStatus||{}),
    yolo_requested:enabled,
  };

  cameraYoloActionBusy=true;
  renderCameraModes();

  try{
    const response=await fetch(
      '/api/camera/passive/yolo',
      {
        method:'POST',
        cache:'no-store',
        headers:{
          'Content-Type':'application/json',
        },
        body:JSON.stringify({
          enabled,
        }),
      },
    );

    let status=null;

    try{
      status=await response.json();
    }catch{}

    if(!response.ok){
      throw new Error(
        status?.error
        || `HTTP ${response.status}`
      );
    }

    if(status){
      renderCameraProcess(status);
    }

  }catch(error){

    window.alert(
      `YOLO switch failed: ${error.message||error}`
    );

  }finally{

    cameraYoloActionBusy=false;

    await pollCameraProcess();
    renderCameraModes();
  }
}


document.querySelectorAll(
  '[data-camera-mode]'
).forEach(button=>{
  button.addEventListener(
    'click',
    ()=>toggleCameraView(button.dataset.cameraMode),
  );
});

$('cameraYoloToggle')?.addEventListener(
  'change',
  event=>setCameraYolo(event.target.checked),
);


function renderCameraSourceMetadata(t={}){
  const count=activeCameraViews.length;
  const columns=count<=1?1:count<=6?2:3;
  const rows=Math.ceil(count/columns);
  const camera=t?.camera||{};
  const fps=finite(
    cameraProcessStatus?.mode_status?.web_derived_fps
  )
    ?Number(
      cameraProcessStatus.mode_status.web_derived_fps
    )
    :30;

  $('cameraMeta').textContent=
    `${count} active · ${columns}×${rows} · ${fps.toFixed(0)} fps target`;

  $('statusCamera').textContent=
    `${count} camera view${count===1?'':'s'} active`;
}

function updateCameraButtons(t){
  renderCameraSourceMetadata(t);

  cameraUrl=fallbackCameraOffer('rgb');

  const link=$('cameraTrustLink');
  const base=cameraBaseForView('rgb');

  if(base){
    link.href=base;
    link.classList.remove('hidden');
  }else{
    link.removeAttribute('href');
    link.classList.add('hidden');
  }

  const state=cameraProcessStatus?.state||'UNAVAILABLE';
  const actionable=(
    state==='RUNNING'
    || state==='RUNNING_EXTERNAL'
    || (
      state==='STOPPED'
      && cameraProcessStatus?.can_start
    )
  );

  $('cameraConnectBtn').disabled=(
    stitchCameraUiPreviewV142()
      ?stitchCameraLocalPowerV158
      :(
          !cameraUrl
          || cameraConnecting
          || cameraProcessActionBusy
          || !actionable
          || (
            state==='RUNNING'
            && allActiveVideoViewsConnected()
          )
        )
  );
}

function cameraState(text,tone,detail){
  setChip(
    $('cameraChip'),
    `CAMERA ${text}`,
    tone==='good'
      ?'good'
      :tone==='warn'
        ?'warn'
        :tone==='bad'
          ?'bad'
          :null,
  );
}

async function waitIceComplete(pc,timeoutMs=3500){
  if(pc.iceGatheringState==='complete')return;

  await new Promise(resolve=>{
    const done=()=>{
      pc.removeEventListener(
        'icegatheringstatechange',
        onChange,
      );
      clearTimeout(timer);
      resolve();
    };

    const onChange=()=>{
      if(pc.iceGatheringState==='complete')done();
    };

    const timer=setTimeout(done,timeoutMs);
    pc.addEventListener(
      'icegatheringstatechange',
      onChange,
    );
  });
}

async function waitCameraViewReady(id){
  if(CAMERA_VIEWS[id]?.transport!=='webrtc'){
    return true;
  }

  for(let attempt=0;attempt<24;attempt++){
    const status=await pollCameraProcess();
    const view=cameraViewProcessStatus(id,status);

    if(view?.port_ready)return true;
    if(
      !['RUNNING','RUNNING_EXTERNAL'].includes(
        status?.state
      )
    )break;

    await new Promise(resolve=>setTimeout(resolve,250));
  }

  return false;
}

async function connectCameraView(id,codec=null){
  const view=CAMERA_VIEWS[id];

  if(
    !view
    || view.transport!=='webrtc'
    || !activeCameraViews.includes(id)
    || cameraPeerConnecting.has(id)
  )return;

  closeCameraPeer(id,{resetState:false});
  cameraPeerConnecting.add(id);
  syncCameraConnectionState();

  setCameraTileState(
    id,
    'CONNECTING',
    `Negotiating ${view.label} WebRTC.`,
    'warn',
  );

  try{
    const offerUrl=fallbackCameraOffer(id);
    if(!offerUrl){
      throw new Error('No WebRTC offer URL.');
    }

    const pc=new RTCPeerConnection({
      sdpSemantics:'unified-plan',
    });

    const entry={
      pc,
      fallback:codec==='vp8',
      frameWatch:null,
    };

    cameraPeers.set(id,entry);
    pc.addTransceiver('video',{direction:'recvonly'});

    pc.addEventListener(
      'connectionstatechange',
      ()=>{
        if(cameraPeers.get(id)?.pc!==pc)return;

        if(pc.connectionState==='connected'){
          setCameraTileState(id,'LIVE','', 'good');
          cameraState('LIVE','good');
        }else if(
          ['failed','disconnected'].includes(
            pc.connectionState
          )
        ){
          setCameraTileState(
            id,
            'LOST',
            `${view.label} connection was lost.`,
            'bad',
          );
          cameraState('DEGRADED','warn');
        }

        syncCameraConnectionState();
        updateCameraButtons(latestEnv?.telemetry||{});
      },
    );

    pc.addEventListener('track',event=>{
      if(
        cameraPeers.get(id)?.pc!==pc
        || event.track.kind!=='video'
      )return;

      const video=cameraVideoElement(id);
      if(!video)return;

      video.srcObject=event.streams[0];
      video.play().catch(()=>{});
      setCameraTileState(id,'LIVE','', 'good');
      cameraState('LIVE','good');

      const startTime=video.currentTime;
      entry.frameWatch=setTimeout(()=>{
        if(
          cameraPeers.get(id)?.pc===pc
          && video.currentTime===startTime
          && !entry.fallback
        ){
          closeCameraPeer(id,{resetState:false});
          connectCameraView(id,'vp8');
        }
      },5000);
    });

    const offer=await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIceComplete(pc);

    const response=await fetch(offerUrl,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        sdp:pc.localDescription.sdp,
        type:pc.localDescription.type,
        codec:codec||null,
      }),
    });

    if(!response.ok){
      throw new Error(
        `teleimager /offer HTTP ${response.status}`
      );
    }

    const answer=await response.json();
    if(answer.error)throw new Error(answer.error);

    await pc.setRemoteDescription(answer);
  }catch(error){
    console.error(
      `${view.label} connection failed`,
      error,
    );
    closeCameraPeer(id,{resetState:false});
    setCameraTileState(
      id,
      'ERROR',
      'Open CERT, accept the certificate, then press Connect views.',
      'bad',
    );
  }finally{
    cameraPeerConnecting.delete(id);
    syncCameraConnectionState();
    renderCameraGrid();
    updateCameraButtons(latestEnv?.telemetry||{});
  }
}

async function connectCamera(){
  if(cameraConnecting)return;

  const ids=activeWebRtcViews();

  if(!ids.length){
    syncPointCloudRuntime();
    cameraState('LIVE','good');
    return;
  }

  cameraState('CONNECTING','warn');

  await Promise.allSettled(
    ids.map(async id=>{
      await waitCameraViewReady(id);
      return connectCameraView(id);
    })
  );

  syncCameraConnectionState();

  if(allActiveVideoViewsConnected()){
    cameraState('LIVE','good');
  }else if(cameraPeers.size){
    cameraState('DEGRADED','warn');
  }else{
    cameraState('ERROR','bad');
  }

  renderCameraProcess(cameraProcessStatus);
}

function stopCamera({silent=false}={}){
  for(const id of Array.from(cameraPeers.keys())){
    closeCameraPeer(id,{resetState:true});
  }

  cameraPeerConnecting.clear();
  syncCameraConnectionState();

  if(!silent){
    cameraState('OFFLINE',null);
  }

  renderCameraGrid();
}

async function startAndConnectCamera(){
  if(cameraProcessActionBusy||cameraConnecting)return;

  let status=await pollCameraProcess();

  if(status?.state==='STOPPED'){
    if(!currentManagementKey()){
      showManagementKeyPrompt(
        'Enter the management key to start the camera server.',
        ()=>startAndConnectCamera(),
      );
      return;
    }

    cameraProcessActionBusy=true;
    updateCameraButtons(latestEnv?.telemetry||{});
    cameraState('STARTING','warn');

    try{
      status=await cameraProcessPost(
        '/api/camera/start'
      );
    }catch(error){
      cameraState('ERROR','bad');
      window.alert(
        `Camera server start failed: ${
          error.message||error
        }`
      );
      return;
    }finally{
      cameraProcessActionBusy=false;
    }
  }

  if(
    status?.state==='CONFLICT'
    || status?.state==='UNAVAILABLE'
    || status?.state==='STOPPING'
  ){
    cameraState('ERROR','bad');
    window.alert(
      status?.last_error
      || `Camera process state: ${
        status?.state||'unknown'
      }`
    );
    return;
  }

  await connectCamera();
}

async function stopCameraButton(){
  if(cameraProcessActionBusy)return;

  // FULL_DASH_YOLO_OFF_ON_DISCONNECT_V12
  const yoloWasOn=Boolean(
    cameraProcessStatus?.yolo_requested
    || cameraProcessStatus?.yolo_actual
    || $('cameraYoloToggle')?.checked
  );

  /*
   * Clear both the real checkbox and the visible V1.9.23
   * proxy immediately, so Disconnect visually means OFF.
   */
  const realYolo=$('cameraYoloToggle');

  if(realYolo){
    realYolo.checked=false;
    realYolo.indeterminate=false;
  }

  const proxyYolo=document.querySelector(
    '#stitchYoloProxyV1923 input[type="checkbox"]'
  );

  if(proxyYolo){
    proxyYolo.checked=false;
    proxyYolo.indeterminate=false;
  }

  /*
   * Also make local process state truthful immediately.
   */
  if(cameraProcessStatus){
    cameraProcessStatus={
      ...cameraProcessStatus,
      yolo_requested:false,
      yolo_actual:false,
    };
  }

  renderCameraModes();

  /*
   * IMPORTANT:
   * shut down the actual YOLO request BEFORE disconnecting
   * the WebRTC camera peers.
   */
  if(yoloWasOn){
    await setCameraYolo(false);
  }


  const status=await pollCameraProcess();

  if(status?.state==='RUNNING'){
    if(!currentManagementKey()){
      showManagementKeyPrompt(
        'Enter the management key to stop the camera server.',
        ()=>stopCameraButton(),
      );
      return;
    }

    if(!window.confirm(
      'Stop the dashboard-managed camera server?'
    ))return;

    stopCamera({silent:true});
    cameraProcessActionBusy=true;

    try{
      await cameraProcessPost('/api/camera/stop');
      cameraState('OFFLINE',null);
    }catch(error){
      window.alert(
        `Camera stop failed: ${error.message||error}`
      );
    }finally{
      cameraProcessActionBusy=false;
      await pollCameraProcess();
    }

    return;
  }

  stopCamera();
}


/* FULL_DASH_CAMERA_CLIENT_V2 */

/*
 * Exact camera power behavior:
 *
 * PAGE LOAD:
 *     Connect     enabled
 *     Disconnect  disabled
 *
 * CONNECTED:
 *     Connect     disabled
 *     Disconnect  enabled
 *
 * DISCONNECTED:
 *     Connect     enabled
 *     Disconnect  disabled
 */

let fullDashCameraConnectedV2=false;
let fullDashCameraBusyV2=false;


/*
 * Browser signaling is same-origin.
 * No browser request is ever made directly to https://robot:6000x.
 */
fallbackCameraOffer=function(id){

  const view=
    CAMERA_VIEWS[id];

  if(
    !view
    ||
    view.transport!=='webrtc'
  ){
    return null;
  }

  return (
    '/api/camera/passive/offer'
    +
    `?view=${encodeURIComponent(id)}`
  );
};


cameraBaseForView=function(){
  return null;
};


async function fullDashCameraPostV2(
  path,
  payload={}
){

  const response=
    await fetch(
      path,
      {
        method:'POST',
        headers:{
          'Content-Type':
            'application/json',
        },
        body:JSON.stringify(
          payload
        ),
      }
    );

  const text=
    await response.text();

  let body={};

  if(text){
    try{
      body=JSON.parse(text);
    }catch{
      body={
        error:text
      };
    }
  }

  if(!response.ok){
    throw new Error(
      body.error
      ||
      `HTTP ${response.status}`
    );
  }

  if(body.camera){
    renderCameraProcess(
      body.camera
    );
  }

  return body;
}


/*
 * Point cloud is part of the same Connect/Disconnect session.
 */
pointCloudActive=function(){

  return (
    fullDashCameraConnectedV2
    &&
    activeCameraViews.includes(
      'pointcloud'
    )
  );
};


const fullDashOriginalUpdateCameraButtonsV2=
  updateCameraButtons;


updateCameraButtons=function(t){

  fullDashOriginalUpdateCameraButtonsV2(
    t
  );

  const trust=$(
    'cameraTrustLink'
  );

  if(trust){
    trust.removeAttribute(
      'href'
    );

    trust.classList.add(
      'hidden'
    );
  }

  const connect=$(
    'cameraConnectBtn'
  );

  const disconnect=$(
    'cameraStopBtn'
  );

  if(!connect || !disconnect){
    return;
  }

  /*
   * No backend process state is allowed to alter this.
   * These two buttons represent the browser camera session only.
   */
  connect.disabled=(
    fullDashCameraBusyV2
    ||
    fullDashCameraConnectedV2
  );

  disconnect.disabled=(
    fullDashCameraBusyV2
    ||
    !fullDashCameraConnectedV2
  );
};


startAndConnectCamera=async function(){

  if(
    fullDashCameraBusyV2
    ||
    fullDashCameraConnectedV2
  ){
    return;
  }

  fullDashCameraBusyV2=true;

  updateCameraButtons(
    latestEnv?.telemetry||{}
  );

  cameraState(
    'CONNECTING',
    'warn'
  );

  try{

    /*
     * Full Dash Connect means ALL six camera products.
     */
    const wanted=
      CAMERA_VIEW_ORDER.slice();

    activeCameraViews=
      wanted.slice();

    await fullDashCameraPostV2(
      '/api/camera/passive/prepare',
      {
        views:wanted
      }
    );

    /*
     * The Teleimager runner watches the views file asynchronously.
     * Do not begin WebRTC until all six requested products have
     * actually been acknowledged by the backend.
     */
    let backendViewsReady=false;

    for(
      let attempt=0;
      attempt<50;
      attempt++
    ){

      const status=
        await pollCameraProcess();

      const requested=
        normalizeCameraViews(
          status?.web_views_requested
          ||
          []
        );

      const actual=
        normalizeCameraViews(
          status?.web_views_actual
          ||
          []
        );

      const requestReady=
        wanted.every(
          id=>
            requested.includes(id)
        );

      const actualReady=
        wanted.every(
          id=>
            actual.includes(id)
        );

      if(
        requestReady
        &&
        actualReady
      ){
        backendViewsReady=true;
        break;
      }

      await new Promise(
        resolve=>
          setTimeout(
            resolve,
            100
          )
      );
    }

    if(!backendViewsReady){
      throw new Error(
        'Camera backend did not activate all six views.'
      );
    }

    activeCameraViews=
      wanted.slice();

    renderCameraModes();

    /*
     * Keep browser selection authoritative for this connection.
     */
    activeCameraViews=
      wanted.slice();

    renderCameraGrid();

    const ids=
      activeWebRtcViews();

    for(const id of ids){

      const ready=
        await waitCameraViewReady(
          id
        );

      if(!ready){
        throw new Error(
          `${cameraModeLabel(id)} did not become ready.`
        );
      }
    }

    await Promise.all(
      ids.map(
        id=>
          connectCameraView(
            id
          )
      )
    );

    /*
     * Give ICE / DTLS a few seconds to settle.
     */
    const deadline=
      performance.now()
      +
      8000;

    while(
      performance.now()
      <
      deadline
    ){

      if(
        allActiveVideoViewsConnected()
      ){
        break;
      }

      await new Promise(
        resolve=>
          setTimeout(
            resolve,
            100
          )
      );
    }

    if(
      !allActiveVideoViewsConnected()
    ){
      throw new Error(
        'Not all selected video views connected.'
      );
    }

    fullDashCameraConnectedV2=true;

    syncPointCloudRuntime();
    renderCameraGrid();

    cameraState(
      'LIVE',
      'good'
    );

  }catch(error){

    console.error(
      'Full Dash camera connection failed',
      error
    );

    fullDashCameraConnectedV2=false;

    stopCamera(
      {
        silent:true
      }
    );

    cameraState(
      'ERROR',
      'bad'
    );

    window.alert(
      `Camera connection failed: ${
        error.message||error
      }`
    );

  }finally{

    fullDashCameraBusyV2=false;

    updateCameraButtons(
      latestEnv?.telemetry||{}
    );
  }
};


stopCameraButton=async function(){

  if(
    fullDashCameraBusyV2
    ||
    !fullDashCameraConnectedV2
  ){
    return;
  }

  fullDashCameraBusyV2=true;

  updateCameraButtons(
    latestEnv?.telemetry||{}
  );

  /*
   * Disconnect means disconnect browser feeds.
   * Camera backend may remain warm on the robot.
   */
  fullDashCameraConnectedV2=false;

  stopCamera();

  syncPointCloudRuntime();
  renderCameraGrid();

  fullDashCameraBusyV2=false;

  updateCameraButtons(
    latestEnv?.telemetry||{}
  );
};


/*
 * Establish the exact initial state immediately.
 */
fullDashCameraConnectedV2=false;
fullDashCameraBusyV2=false;

updateCameraButtons(
  latestEnv?.telemetry||{}
);




/* FULL_DASH_CAMERA_WEBRTC_V3 */

/*
 * Connect each WebRTC publisher serially.
 *
 * Do not launch five /offer negotiations simultaneously.
 * Do not automatically replace H264 with VP8.
 */

async function fullDashConnectOneV3(id){

  const view=
    CAMERA_VIEWS[id];

  if(
    !view
    ||
    view.transport!=='webrtc'
  ){
    throw new Error(
      `Invalid WebRTC camera view: ${id}`
    );
  }

  closeCameraPeer(
    id,
    {
      resetState:false
    }
  );

  cameraPeerConnecting.add(
    id
  );

  syncCameraConnectionState();

  setCameraTileState(
    id,
    'CONNECTING',
    `Connecting ${view.label}…`,
    'warn'
  );

  const pc=
    new RTCPeerConnection(
      {
        sdpSemantics:
          'unified-plan'
      }
    );

  const entry={
    pc,
    fallback:false,
    frameWatch:null,
  };

  cameraPeers.set(
    id,
    entry
  );

  pc.addTransceiver(
    'video',
    {
      direction:
        'recvonly'
    }
  );

  let receivedVideo=false;


  pc.addEventListener(
    'track',
    event=>{

      if(
        cameraPeers.get(id)?.pc
        !==
        pc
      ){
        return;
      }

      if(
        event.track.kind
        !==
        'video'
      ){
        return;
      }

      receivedVideo=true;

      const video=
        cameraVideoElement(
          id
        );

      if(!video){
        return;
      }

      video.srcObject=
        event.streams[0];

      video.muted=true;
      video.playsInline=true;
      video.autoplay=true;

      video.play()
        .catch(
          ()=>{}
        );

      setCameraTileState(
        id,
        'LIVE',
        '',
        'good'
      );
    }
  );


  pc.addEventListener(
    'connectionstatechange',
    ()=>{

      if(
        cameraPeers.get(id)?.pc
        !==
        pc
      ){
        return;
      }

      if(
        pc.connectionState
        ===
        'connected'
      ){

        setCameraTileState(
          id,
          'LIVE',
          '',
          'good'
        );

      }else if(
        [
          'failed',
          'disconnected',
          'closed'
        ].includes(
          pc.connectionState
        )
      ){

        setCameraTileState(
          id,
          'LOST',
          `${view.label}: ${pc.connectionState}`,
          'bad'
        );
      }
    }
  );


  try{

    const offer=
      await pc.createOffer();

    await pc.setLocalDescription(
      offer
    );

    await waitIceComplete(
      pc
    );

    const response=
      await fetch(
        '/api/camera/passive/offer'
        +
        `?view=${encodeURIComponent(id)}`,
        {
          method:'POST',

          headers:{
            'Content-Type':
              'application/json',
          },

          body:JSON.stringify(
            {
              sdp:
                pc.localDescription.sdp,

              type:
                pc.localDescription.type,

              codec:null,
            }
          ),
        }
      );


    if(!response.ok){

      const detail=
        await response.text();

      throw new Error(
        `${view.label} signaling HTTP `
        +
        `${response.status}: `
        +
        `${detail}`
      );
    }


    const answer=
      await response.json();

    if(answer.error){
      throw new Error(
        `${view.label}: ${answer.error}`
      );
    }


    await pc.setRemoteDescription(
      answer
    );


    const deadline=
      performance.now()
      +
      10000;


    while(
      performance.now()
      <
      deadline
    ){

      if(
        pc.connectionState
        ===
        'connected'
      ){

        cameraPeerConnecting.delete(
          id
        );

        syncCameraConnectionState();

        setCameraTileState(
          id,
          'LIVE',
          '',
          'good'
        );

        return true;
      }


      if(
        [
          'failed',
          'closed'
        ].includes(
          pc.connectionState
        )
      ){
        break;
      }


      await new Promise(
        resolve=>
          setTimeout(
            resolve,
            100
          )
      );
    }


    throw new Error(
      `${view.label} did not connect `
      +
      `(connection=${pc.connectionState}, `
      +
      `ice=${pc.iceConnectionState}, `
      +
      `gathering=${pc.iceGatheringState}, `
      +
      `signaling=${pc.signalingState}, `
      +
      `video=${receivedVideo})`
    );


  }catch(error){

    cameraPeerConnecting.delete(
      id
    );

    closeCameraPeer(
      id,
      {
        resetState:false
      }
    );

    setCameraTileState(
      id,
      'ERROR',
      String(
        error.message
        ||
        error
      ),
      'bad'
    );

    throw error;
  }
}


/*
 * Override only the Full Dash Connect action.
 */
startAndConnectCamera=async function(){

  if(
    fullDashCameraBusyV2
    ||
    fullDashCameraConnectedV2
  ){
    return;
  }


  fullDashCameraBusyV2=true;

  updateCameraButtons(
    latestEnv?.telemetry||{}
  );

  cameraState(
    'CONNECTING',
    'warn'
  );


  try{

    const wanted=
      CAMERA_VIEW_ORDER.slice();

    activeCameraViews=
      wanted.slice();


    await fullDashCameraPostV2(
      '/api/camera/passive/prepare',
      {
        views:wanted
      }
    );


    /*
     * Wait for the camera runner to acknowledge all products.
     */
    let backendReady=false;

    for(
      let attempt=0;
      attempt<80;
      attempt++
    ){

      const status=
        await pollCameraProcess();

      const actual=
        normalizeCameraViews(
          status?.web_views_actual
          ||
          []
        );

      if(
        wanted.every(
          id=>
            actual.includes(id)
        )
      ){
        backendReady=true;
        break;
      }

      await new Promise(
        resolve=>
          setTimeout(
            resolve,
            100
          )
      );
    }


    if(!backendReady){
      throw new Error(
        'Camera backend did not activate all six views.'
      );
    }


    activeCameraViews=
      wanted.slice();

    renderCameraModes();

    activeCameraViews=
      wanted.slice();

    renderCameraGrid();


    const ids=
      activeWebRtcViews();


    /*
     * SERIAL connection is intentional.
     */
    for(const id of ids){

      const ready=
        await waitCameraViewReady(
          id
        );

      if(!ready){
        throw new Error(
          `${cameraModeLabel(id)} publisher is not ready.`
        );
      }

      await fullDashConnectOneV3(
        id
      );
    }


    /*
     * All five video peers succeeded.
     * Point cloud becomes active as part of the same session.
     */
    fullDashCameraConnectedV2=true;

    syncPointCloudRuntime();
    renderCameraGrid();

    cameraState(
      'LIVE',
      'good'
    );


  }catch(error){

    const states=
      activeWebRtcViews()
        .map(
          id=>{

            const pc=
              cameraPeers.get(id)?.pc;

            return (
              `${id}=`
              +
              (
                pc
                  ?`${pc.connectionState}/${pc.iceConnectionState}`
                  :'none'
              )
            );
          }
        )
        .join(', ');


    console.error(
      'Full Dash camera V3 failed:',
      error,
      states
    );


    fullDashCameraConnectedV2=false;

    stopCamera(
      {
        silent:true
      }
    );

    cameraState(
      'ERROR',
      'bad'
    );


    window.alert(
      'Camera connection failed:\n'
      +
      String(
        error.message
        ||
        error
      )
      +
      '\n\n'
      +
      states
    );


  }finally{

    fullDashCameraBusyV2=false;

    updateCameraButtons(
      latestEnv?.telemetry||{}
    );
  }
};


$('cameraConnectBtn').addEventListener(
  'click',
  ()=>{
    if(stitchCameraUiPreviewV142()){
      stitchCameraLocalPowerV158=true;
      renderCameraProcess(cameraProcessStatus||{});
      return;
    }

    startAndConnectCamera();
  },
);

$('cameraStopBtn').addEventListener(
  'click',
  ()=>{
    if(stitchCameraUiPreviewV142()){
      stitchCameraLocalPowerV158=false;
      renderCameraProcess(cameraProcessStatus||{});
      return;
    }

    stopCameraButton();
  },
);

/* ---------- Robot twin ---------- */
function jointGroup(i){
  if(i<6)return 'LEFT LEG'; if(i<12)return 'RIGHT LEG'; if(i<15)return 'WAIST'; if(i<22)return 'LEFT ARM'; return 'RIGHT ARM';
}
function arrAt(a,i){return Array.isArray(a)&&i>=0&&i<a.length?a[i]:null;}
function armLocalIndex(i){return i>=15&&i<=28?i-15:null;}
function formatTemps(pair){
  if(!Array.isArray(pair))return '—'; const vals=pair.filter(finite).map(x=>Number(x).toFixed(0)); return vals.length?`${vals.join('/')} °C`:'—';
}
function maxAbs(arr){const v=(Array.isArray(arr)?arr:[]).filter(finite).map(x=>Math.abs(Number(x)));return v.length?Math.max(...v):null;}
function maxTemp(pairs){const v=[];for(const p of Array.isArray(pairs)?pairs:[])if(Array.isArray(p))for(const x of p)if(finite(x))v.push(Number(x));return v.length?Math.max(...v):null;}
function renderSelectedJoint(t){
  const r=t?.robot||{},a=t?.arms||{},i=Math.max(0,Math.min(28,selectedJointIndex));
  const names=Array.isArray(r.joint_names)&&r.joint_names.length>=29?r.joint_names:(G1Twin.jointNames||[]);
  const name=names[i]||`joint_${i}`; const local=armLocalIndex(i);
  $('selectedJointName').textContent=name; $('selectedJointIndex').textContent=`#${i}`; $('selectedJointGroup').textContent=jointGroup(i);
  $('selectedMeasuredQ').textContent=n(arrAt(r.measured_q_rad,i),2,' rad'); $('selectedDq').textContent=n(arrAt(r.measured_dq_rps,i),2,' rad/s'); $('selectedTau').textContent=n(arrAt(r.tau_est,i),2);
  $('selectedTemp').textContent=formatTemps(arrAt(r.temperatures_c,i)); const ms=arrAt(r.motor_state,i); $('selectedMotorState').textContent=ms==null?'motor —':`motor ${ms}`;
  const h=G1Twin.getJointHealth(i);
  const sev=Number(h?.severity); const healthTone=sev>=3?'bad':sev>=1?'warn':Number.isFinite(sev)?'good':null;
  setChip(
    $('selectedHealthChip'),
    h?.label==='NOMINAL'
      ?'NORMAL'
      :(h?.label||'HEALTH —'),
    healthTone
  );
  $('selectedTorqueUtil').textContent=finite(h?.torqueUtil)?`${(Number(h.torqueUtil)*100).toFixed(0)}%`:'—';
  $('selectedEffortLimit').textContent=finite(h?.effortLimitNm)?`${Number(h.effortLimitNm).toFixed(0)} N·m`:'—';
  $('selectedTempBar').style.width=`${pct(finite(h?.tempC)?(Number(h.tempC)/100)*100:0)}%`;
  $('selectedTorqueBar').style.width=`${pct(finite(h?.torqueUtil)?Number(h.torqueUtil)*100:0)}%`;
  $('selectedTempBar').dataset.level=finite(h?.tempLevel)?String(h.tempLevel):'';
  $('selectedTorqueBar').dataset.level=finite(h?.torqueLevel)?String(h.torqueLevel):'';
  if(local!==null){
    $('selectedPublishedQ').textContent=n(arrAt(a.published_q_rad,local),2,' rad'); $('selectedTargetQ').textContent=n(arrAt(a.target_q_rad,local),2,' rad'); $('selectedIkQ').textContent=n(arrAt(a.ik_q_rad,local),2,' rad'); $('selectedErrorQ').textContent=n(arrAt(a.published_error_rad,local),2,' rad');
    $('selectedJointNote').textContent='Arm command fields compare measured LowState against the published arm command, target, and latest IK solution.';
  }else{
    $('selectedPublishedQ').textContent='—'; $('selectedTargetQ').textContent='—'; $('selectedIkQ').textContent='—'; $('selectedErrorQ').textContent='—';
    $('selectedJointNote').textContent='Leg and waist telemetry is read-only LowState feedback. The dashboard does not synthesize lower-body command targets.';
  }
}
function renderRobot(t){
  const r=t?.robot||{},a=t?.arms||{}; const hasFull=Array.isArray(r.measured_q_rad)&&r.measured_q_rad.length>=29;
  const mm=r.mode_machine;
  const meshStats=G1Twin.getStats();
  const kin=!hasFull?'controller V1.4 full-body telemetry required':mm===5?'mode 5 · rev_1_0 kinematics':mm==null?'rev_1_0 kinematics · mode unknown':`mode ${mm} · rev_1_0 kinematics preview`;
  $('robotModelStatus').textContent=`${kin} · ${meshStats.modelStatus}`;
  $('robotModeMachine').textContent=r.mode_machine==null?'—':String(r.mode_machine); $('statusModeMachine').textContent=r.mode_machine==null?'—':String(r.mode_machine);
  G1Twin.setHealthData(r);
  const armErr=finite(a.max_abs_published_error_rad)?Number(a.max_abs_published_error_rad):maxAbs(a.published_error_rad);
  const bodyTemp=maxTemp(r.temperatures_c); const hs=G1Twin.getHealthSummary();
  $('robotMaxError').textContent=n(armErr,2,' rad');
  $('robotPeakTorque').textContent=finite(hs?.peakTorqueUtil)?`${(Number(hs.peakTorqueUtil)*100).toFixed(0)}%`:'—';
  $('robotMaxTemp').textContent=n(bodyTemp,0,'°C'); $('robotHealthSummary').textContent=
    hs?.label==='NOMINAL'
      ?'NORMAL'
      :(hs?.label||'—');
  setTone($('robotHealthSummary'),hs?.severity>=3?'bad':hs?.severity>=1?'warn':Number.isFinite(hs?.severity)?'good':null);
  renderSelectedJoint(t||{});
}

G1Twin.init($('robotTwinCanvas'),(i)=>{selectedJointIndex=i;renderSelectedJoint(latestEnv?.telemetry||{});});
G1Twin.setRenderVisible(currentView==='live');

const slamRobotModel=G1Twin.createSceneReplica();

if(slamRobotModel){

  /*
   * BACALBASA_SLAM_ROBOT_AMBER_V2209
   *
   * This replica belongs only to the SLAM scene.
   * Clone materials first so the normal Live twin is untouched.
   */

  slamRobotModel.traverse?.(node=>{

    if(!node?.material){
      return;
    }

    const tintMaterial=material=>{

      if(!material?.clone){
        return material;
      }

      const clone=material.clone();

      if(clone.color?.setHex){
        clone.color.setHex(0xd39a22);
      }

      return clone;
    };

    if(Array.isArray(node.material)){

      node.material=
        node.material.map(
          tintMaterial
        );

    }else{

      node.material=
        tintMaterial(
          node.material
        );
    }
  });

  slamViewer.setRobotModel(
    slamRobotModel
  );
}
G1Twin.selectJoint(selectedJointIndex);
$('ghostToggle').addEventListener('change',e=>G1Twin.setGhostVisible(e.target.checked));
$('jointToggle').addEventListener('change',e=>G1Twin.setJointsVisible(e.target.checked));
$('healthToggle').addEventListener('change',e=>{G1Twin.setHealthVisible(e.target.checked);$('healthLegendPrimary').classList.toggle('hidden',!e.target.checked);renderSelectedJoint(latestEnv?.telemetry||{});});
$('healthModeSelect').addEventListener('change',e=>{G1Twin.setHealthMode(e.target.value);renderSelectedJoint(latestEnv?.telemetry||{});const hs=G1Twin.getHealthSummary();$('robotHealthSummary').textContent=hs?.label||'—';setTone($('robotHealthSummary'),hs?.severity>=3?'bad':hs?.severity>=1?'warn':Number.isFinite(hs?.severity)?'good':null);});
$('twinResetBtn').addEventListener('click',()=>G1Twin.resetView());

/* ---------- Hands / events / status ---------- */
function validatedHandFeedback(values){
  if(!Array.isArray(values)||values.length<6)return null;
  const out=values.slice(0,6).map(Number);
  // Unitree documents rt/inspire/state q in the same normalized [0,1]
  // convention as rt/inspire/cmd. Reject a whole side if the service returns
  // out-of-range/raw values; clipping those values would falsely look valid.
  if(!out.every(v=>Number.isFinite(v)&&v>=-0.02&&v<=1.02))return null;
  return out.map(v=>Math.max(0,Math.min(1,v)));
}
function handFeedbackSides(feedbackState){
  const fb=Array.isArray(feedbackState)?feedbackState:[];
  return {
    right:validatedHandFeedback(fb.slice(0,6)),
    left:validatedHandFeedback(fb.slice(6,12)),
  };
}
// BACA_FAST_HANDS_XR_V2
let handMatrixCache = null;

function renderHandMatrix(currentLeft,currentRight,feedbackState){
  const body=$('handMatrixBody');
  if(!body)return;

  const names=['Pinky','Ring','Middle','Index','Thumb','Thumb rot'];
  const validCache =
    handMatrixCache?.body === body
    && body.children.length === 6
    && handMatrixCache.rows.every(row => row.parentNode === body)
    && handMatrixCache.channels.every(channel =>
      body.contains(channel.fill)
      && body.contains(channel.marker)
      && body.contains(channel.command)
      && body.contains(channel.feedback)
    );

  if(!validCache){
    const rows=[];
    const channels=[];
    const channelHtml=`<div class="hand-channel">
      <div class="hand-bar"><i class="hand-command-fill" style="width:0%"></i><b class="hand-feedback-marker" style="display:none;left:0%"></b></div>
      <span class="hand-readout"><strong>—</strong><em>—</em></span>
    </div>`;

    body.replaceChildren();
    for(const name of names){
      const row=document.createElement('div');
      row.className='hand-matrix-row';
      row.innerHTML=`<span class="hand-finger-name">${name}</span>${channelHtml}${channelHtml}`;
      body.appendChild(row);
      rows.push(row);

      for(const channel of row.querySelectorAll('.hand-channel')){
        channels.push({
          fill:channel.querySelector('.hand-command-fill'),
          marker:channel.querySelector('.hand-feedback-marker'),
          command:channel.querySelector('.hand-readout strong'),
          feedback:channel.querySelector('.hand-readout em'),
        });
      }
    }
    handMatrixCache={body,rows,channels};
  }

  const left=Array.isArray(currentLeft)?currentLeft:[];
  const right=Array.isArray(currentRight)?currentRight:[];
  const sides=handFeedbackSides(feedbackState);
  const fbLeft=sides.left||[], fbRight=sides.right||[];

  const setText=(element,value)=>{
    if(element.textContent!==value)element.textContent=value;
  };
  const setStyle=(element,key,value)=>{
    if(element.style[key]!==value)element.style[key]=value;
  };
  const updateChannel=(channel,cmd,feedback)=>{
    const c=finite(cmd)?Number(cmd):null;
    const f=finite(feedback)?Number(feedback):null;

    setStyle(channel.fill,'width',`${c===null?0:pct(c*100)}%`);
    setStyle(channel.marker,'display',f===null?'none':'');
    if(f!==null)setStyle(channel.marker,'left',`${pct(f*100)}%`);
    setText(channel.command,c===null?'—':c.toFixed(2));
    setText(channel.feedback,f===null?'—':f.toFixed(2));
  };

  for(let i=0;i<6;i++){
    updateChannel(handMatrixCache.channels[i*2],left[i],fbLeft[i]);
    updateChannel(handMatrixCache.channels[i*2+1],right[i],fbRight[i]);
  }
}

function teleopHandsAllowed(env){
  return controllerStatus?.state==='RUNNING'
    && env?.bridge?.telemetry_online===true
    && env?.telemetry?.mode?.state==='XR_ACTIVE';
}

function renderHandsFromPose(pose){
  const allowed=teleopHandsAllowed(latestEnv)
    && pose?.bridge?.telemetry_online===true;
  const hands=allowed?pose?.hands:null;
  renderHandMatrix(
    hands?.current_left||[],
    hands?.current_right||[],
    hands?.feedback_state||[],
  );
}

function renderTeleopXr(env){
  const running=controllerStatus?.state==='RUNNING';
  const fresh=env?.bridge?.telemetry_online===true;
  const telemetry=env?.telemetry;
  const mode=telemetry?.mode?.state;
  let display='—';
  let tone=null;

  if(running&&fresh){
    if(mode==='XR_TRACKING_HOLD'){
      display='HOLD';
      tone='warn';
    }else if(mode==='XR_ACTIVE'){
      const ok=telemetry?.health?.xr?.ok;
      if(typeof ok==='boolean'){
        display=ok?'OK':'BAD';
        tone=ok?'good':'warn';
      }
    }
  }

  const element=$('xrValue');
  if(element){
    if(element.textContent!==display)element.textContent=display;
    for(const name of ['good','warn','bad']){
      if(element.classList.contains(name))element.classList.remove(name);
    }
    setTone(element,tone);
  }
  const reason=$('xrReason');
  if(reason){
    const text=display==='—'?'—':(telemetry?.health?.xr?.reason||'—');
    if(reason.textContent!==text)reason.textContent=text;
  }
}

let lastEventSignature='';
function renderEvents(env){
  const events=Array.isArray(env.events)?env.events:[]; const sig=events.slice(0,80).map(e=>`${e.id||''}:${e.message||''}`).join('|'); if(sig===lastEventSignature)return; lastEventSignature=sig; const all=$('allEvents'); if(!all)return; all.innerHTML='';
  if(!events.length){all.innerHTML='<div class="empty">No events yet</div>';return;}
  events.slice(0,80).forEach(e=>{const d=document.createElement('div');d.className=`event ${e.level||'info'}`;d.innerHTML=`<span class="time">${fmtTime(e.unix_time_s)}</span><span class="cat">${e.category||''}</span><span>${e.message||''}</span>`;all.appendChild(d);});
}

function renderActionReadiness(t){
  const actions=t?.actions||{}, handover=actions?.xr_handover||{}, cond=actions?.engagement_conditions||{};
  latestActionReadiness=actions;
  const has=!!actions?.schema;
  const available=has && handover?.available===true;
  const label=has?(handover?.label||'No action'):'Controller action telemetry required';
  const operation=has?(handover?.operation||'NONE'):'—';
  const next=has?(handover?.would_enter_state||'—'):'—';
  const reason=has?(handover?.reason||'—'):'Controller action-readiness telemetry required.';
  const channel=actions?.request_channel_enabled===true;
  const managerReady=controllerStatus?.can_request_action===true;

  $('actionLabel').textContent=label;
  $('actionOperation').textContent=operation;
  $('actionNextState').textContent=next;
  $('actionReason').textContent=reason;
  const readinessText=!has?'READ ONLY':!channel?'READ ONLY':available?'READY':'BLOCKED';
  const readinessTone=has&&channel?(available?'good':'warn'):null;
  setChip($('actionReadinessChip'),readinessText,readinessTone);

  const condChip=(id,text,ok,neutral=false)=>{const el=$(id); el.textContent=text; el.classList.toggle('cond-good',!!ok); el.classList.toggle('cond-warn',!ok&&!neutral); el.classList.toggle('cond-neutral',!!neutral);};

  /* STITCH_SAFE_COND_PAIR
     Preserve the normal Dragos refresh path while letting Stop/Fault
     use the same label/value presentation as the other rail rows. */
  const condPair=(id,value,ok,neutral=false)=>{
    const el=$(id);
    const valueEl=el?.querySelector('.stitch-status-value');
    if(valueEl)valueEl.textContent=value;
    el?.classList.toggle('cond-good',!!ok);
    el?.classList.toggle('cond-warn',!ok&&!neutral);
    el?.classList.toggle('cond-neutral',!!neutral);
  };

  condChip('actionCondLowstate',`LOW ${cond.lowstate_ok?'OK':'BAD'}`,cond.lowstate_ok===true,!has);
  condChip('actionCondXr',`XR ${cond.xr_ok?'OK':'WAIT'}`,cond.xr_ok===true,!has);



  condPair(
    'actionCondFault',
    cond.safety_fault_clear
      ? 'CLEAR'
      : 'HOLD',
    cond.safety_fault_clear===true,
    !has
  );

  const actionBtn=$('xrActionBtn');
  actionBtn.textContent=xrActionButtonLabel(operation);
  actionBtn.disabled=xrActionBusy || !channel || !available || !managerReady || !['REQUEST_XR','CANCEL_XR_REQUEST','HAND_BACK_ARMS'].includes(operation);
  actionBtn.classList.toggle('danger-btn',operation==='HAND_BACK_ARMS');
  actionBtn.classList.toggle('primary-btn',operation!=='HAND_BACK_ARMS');
  syncXrActionPairV16();
  if(!xrActionBusy){
    if(!channel)setXrActionResult('Controller request channel disabled.');
    else if(!managerReady)setXrActionResult('Start the listener from this dashboard to enable XR requests.');
    else if(!available)setXrActionResult(reason,'warn');
    else setXrActionResult('Controller will re-check this action when clicked.');
  }

  setChip($('statusActionChip'),readinessText,readinessTone);
  $('statusActionLabel').textContent=label;
  $('statusActionOperation').textContent=operation;
  $('statusActionNextState').textContent=next;
  $('statusActionChannel').textContent=channel?'ENABLED':'DISABLED';
  setTone($('statusActionChannel'),channel?'good':null);
  $('statusActionReason').textContent=reason+(channel?'':' Browser requests are unavailable until the controller action channel is enabled.');
}

function render(env){
  latestEnv=env; const t=env.telemetry; const bridge=env.bridge||{};
  renderTeleopXr(env);
  // BACA_HANDS_POINT_FIX_V1
  if(!t)renderHandMatrix([],[],[]);
  setChip($('telemetryChip'),bridge.telemetry_online?'TELEMETRY LIVE':'TELEMETRY STALE',bridge.telemetry_online?'good':'warn');
  $('packetAge').textContent=finite(bridge.packet_age_s)?`${Math.round(bridge.packet_age_s*1000)} ms`:'—'; $('statusPacketAge').textContent=$('packetAge').textContent;
  if(!t){
    $('versionText').textContent='waiting for controller'; updateCameraButtons({}); if(!cameraPc&&!cameraConnecting)setChip($('cameraChip'),'CAMERA OFFLINE','warn');
    $('robotModelStatus').textContent='waiting for controller'; renderRobot({}); renderActionReadiness({}); renderEvents(env); return;
  }
  $('versionText').textContent=val(t,['controller','version'],'—');
  const state=val(t,['mode','state'],'—'), weight=Number(val(t,['mode','arm_ownership_weight'],0));
  $('robotWeight').textContent=n(weight,2); $('statusOwnership').textContent=n(weight,2); setChip($('statusModeChip'),state,state==='SAFETY_FAULT_HOLD'?'bad':state==='XR_TRACKING_HOLD'?'warn':null);
  const xrOk=!!val(t,['health','xr','ok']), xrReason=val(t,['health','xr','reason'],'—');
  // Live XR presentation is owned by renderTeleopXr().
  setChip($('statusXrChip'),xrOk?'XR OK':'XR BAD',xrOk?'good':'warn');
  $('statusXrReason').textContent=xrReason;
  const lowOk=!!val(t,['health','lowstate','ok']);
  setChip(
    $('statusLowstateChip'),
    lowOk?'LOWSTATE OK':'LOWSTATE BAD',
    lowOk?'good':'warn'
  );
  const hm=val(t,['hands','mode'],'—'), htrack=!!val(t,['hands','tracking_valid']); $('handsValue').textContent=hm; $('handsReason').textContent=htrack?'tracking OK':val(t,['hands','tracking_reason'],'—'); setTone($('handsValue'),hm==='FOLLOW'?'good':hm==='HOLD'||hm==='REACQUIRE'?'warn':null);
  const guard=!!val(t,['health','tracking_guard','active']);

  const guardReasonText=guard
    ?`L=${+!!val(t,['health','tracking_guard','rejected_left'])} R=${+!!val(t,['health','tracking_guard','rejected_right'])}`
    :'coherent wrist pair';

  $('statusGuard').textContent=
    guard
      ?guardReasonText
      :'CLEAR';
  const gate=val(t,['motion','stop_gate'],{});

  const gateText=gate.ready
    ?`READY ${n(gate.elapsed_s,1,'s')}`
    :gate.instant
      ?`TIMING ${n(gate.elapsed_s,1,'s')}`
      :'MOVING';

  $('statusStopGate').textContent=gateText;
  const fp=val(t,['health','finger_worker','phase'],'—'); $('fingerPhase').textContent=fp; $('statusFingerPhase').textContent=fp; const ff=!!val(t,['health','finger_worker','feedback_fault']); const fa=val(t,['health','finger_worker','feedback_age_s']); const inspire=ff?`FAULT ${n(fa,2,'s')}`:`OK ${n(fa,2,'s')}`; $('fingerFeedback').textContent=inspire; $('statusInspire').textContent=inspire;
  $('safetyFault').textContent=val(t,['mode','safety_fault_reason'],'none')||'none'; $('trackingHoldReason').textContent=val(t,['mode','tracking_hold_reason'],'none')||'none'; $('shutdownPending').textContent=boolWord(val(t,['mode','shutdown_pending']));
  const al=val(t,['tracking','alignment'],{}); $('alignmentFrames').textContent=`${al.stable_frames??0}/${al.required_frames??'—'}`;
  const hold=val(t,['tracking','hold'],{}); const holdPos=`${n(hold.position_error_m,3,' m')} / ${n(hold.position_limit_m,3,' m')}`,holdRot=`${n(hold.rotation_error_deg,1,'°')} / ${n(hold.rotation_limit_deg,1,'°')}`; $('holdPosition').textContent=holdPos; $('statusHoldPosition').textContent=holdPos; $('holdRotation').textContent=holdRot; $('statusHoldRotation').textContent=holdRot; $('resumeFrames').textContent=`${hold.stable_frames??0}/${hold.required_frames??'—'}`; $('resumeBar').style.width=`${pct(100*(hold.stable_frames||0)/(hold.required_frames||1))}%`; $('recoveryPanel').classList.toggle('hidden',state!=='XR_TRACKING_HOLD');
  const r3=val(t,['motion','r3'],{}), lb=val(t,['motion','lower_body'],{}); $('r3Max').textContent=n(r3.max_abs_axis,3); $('leftStick').textContent=`${n(r3.lx,2)}, ${n(r3.ly,2)}`; $('rightStick').textContent=`${n(r3.rx,2)}, ${n(r3.ry,2)}`; $('dqCombined').textContent=`${n(lb.dq_max_rps,3)} / ${n(lb.dq_rms_rps,3)} rad/s`; $('yawRate').textContent=n(lb.yaw_rate_rps,3,' rad/s');
  const armErr=val(t,['health','arm_publisher','error']); $('statusArmPublisher').textContent=armErr?`ERROR ${armErr}`:'OK';

  renderActionReadiness(t);
  renderRobot(t);
  const handFeedbackState=val(t,['hands','feedback_state'],[]);
  // Active values come from the existing faster pose requests.
  // The slower status poll only clears inactive/stale values.
  if(!teleopHandsAllowed(env))renderHandMatrix([],[],[]);
  $('handModeDetail').textContent=hm;
  const handFbAge=val(t,['health','finger_worker','feedback_age_s']);
  const handFbFault=!!val(t,['health','finger_worker','feedback_fault']);
  const handFbSides=handFeedbackSides(handFeedbackState);
  const handFbValid=!!handFbSides.left&&!!handFbSides.right;
  $('handFeedbackDetail').textContent=handFbFault?`STALE ${n(handFbAge,2,'s')}`:handFbValid?`${n(handFbAge,2,'s')}`:'INVALID RANGE';
  setTone($('handFeedbackDetail'),handFbFault||!handFbValid?'warn':'good');
  $('handRetargets').textContent=val(t,['hands','retarget_count'],'—'); $('handReacquire').textContent=val(t,['hands','reacquire_ready'])?'READY':`${val(t,['hands','reacquire_count'],0)}/${val(t,['hands','reacquire_required_frames'],'—')}`; $('thumbStatus').textContent=val(t,['controller','symmetric_thumb_rotation'])===false?'NO':'YES';
  const c=t.camera||{};
  updateCameraButtons(t);
  if(!cameraPc&&!cameraConnecting){
    const configured=currentCameraSource().id==='lifecam'||c.webrtc_enabled;
    setChip(
      $('cameraChip'),
      configured?'CAMERA OFFLINE':'CAMERA OFF',
      configured?'warn':null
    );
  }
  renderEvents(env);
}


/* ---------- PC2 / Unitree system health ---------- */
const bytes = (x) => {
  if(!finite(x)) return '—';
  let v=Number(x); const units=['B','KB','MB','GB','TB']; let i=0;
  while(Math.abs(v)>=1024 && i<units.length-1){v/=1024;i++;}
  return `${v.toFixed(i>=3?1:0)} ${units[i]}`;
};
const duration = (sec) => {
  if(!finite(sec)) return '—';
  let s=Math.max(0,Math.floor(Number(sec))); const d=Math.floor(s/86400); s%=86400; const h=Math.floor(s/3600); s%=3600; const m=Math.floor(s/60);
  return d?`${d}d ${h}h`:h?`${h}h ${m}m`:`${m}m`;
};
function endpointState(id,on){ const el=$(id); if(!el)return; el.textContent=on?'LISTENING':'OFFLINE'; setTone(el,on?'good':'warn'); }
function processState(id,count){ const el=$(id); if(!el)return; const n=Number(count||0); el.textContent=n>0?`${n} running`:'not found'; setTone(el,n>0?'good':'warn'); }
let lastRobotServices=[];
let serviceControlConfig=null;
let serviceControlPollBusy=false;
let serviceActionBusyName=null;

const serviceEnabled=(s)=>typeof s?.enabled==='boolean'?s.enabled:Number(s?.status)===0?true:Number(s?.status)===1?false:null;
function servicePolicyFor(svc){
  const name=String(svc?.name||'');
  if(svc?.protect)return 'PROTECTED';
  const p=serviceControlConfig?.policy||{};
  if(Array.isArray(p.hard_deny_services)&&p.hard_deny_services.includes(name))return 'PROTECTED';
  if(Array.isArray(p.read_only_services)&&p.read_only_services.includes(name))return 'READ_ONLY';
  if(Array.isArray(p.allowed_services)&&p.allowed_services.includes(name))return 'ALLOWED';
  return 'UNKNOWN';
}
function renderServiceControlConfig(cfg){
  serviceControlConfig=cfg||{};
  const enabled=!!serviceControlConfig.enabled;
  const worker=serviceControlConfig.worker||{};
  const ready=enabled&&worker.status==='READY';
  setChip($('serviceControlChip'),ready?'CONTROL READY':enabled?'CONTROL OFFLINE':'CONTROL OFF',ready?'good':enabled?'warn':null);
  if($('serviceControlChip'))$('serviceControlChip').title=worker.reason||'';
  renderServiceList();
}
async function pollServiceControl(){
  if(serviceControlPollBusy)return;
  serviceControlPollBusy=true;
  try{
    const r=await fetch('/api/services/control',{cache:'no-store'});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    renderServiceControlConfig(await r.json());
  }catch(err){
    serviceControlConfig={enabled:false,worker:{status:'OFFLINE',reason:String(err)},policy:{}};
    setChip($('serviceControlChip'),'CONTROL OFFLINE','warn');
    console.debug('service control endpoint unavailable',err);
    renderServiceList();
  }finally{serviceControlPollBusy=false;}
}
function renderRobotServices(api){
  const available=!!api?.available;
  setChip($('robotStateChip'),available?'API ONLINE':api?.enabled===false?'API OFF':'API UNAVAILABLE',available?'good':api?.enabled===false?null:'warn');
  $('robotStateClientVersion').textContent=api?.client_api_version??'—';
  $('robotStateServerVersion').textContent=api?.server_api_version??'—';
  const match=api?.api_version_match;
  $('robotStateVersionMatch').textContent=match===true?'YES':match===false?'NO':'—';
  setTone($('robotStateVersionMatch'),match===true?'good':match===false?'warn':null);
  $('robotStateServiceCount').textContent=finite(api?.service_count)?String(api.service_count):'—';
  const err=$('robotStateError');
  if(api?.error){err.textContent=api.error;}else{err.textContent=api?.module?`inventory via ${api.module} · writes isolated in allowlisted worker`:'service inventory';}
  err.classList.remove('hidden');
  lastRobotServices=Array.isArray(api?.services)?api.services:[];
  renderServiceList();
}
function servicePolicyClassName(policy){return String(policy||'UNKNOWN').toLowerCase();}
function renderServiceList(){
  const list=$('robotServiceList'); if(!list)return;
  list.innerHTML='';
  const textFilter=String($('serviceFilter')?.value||'').trim().toLowerCase();
  const stateFilter=String($('serviceStateFilter')?.value||'ALL');
  const policyFilter=String($('servicePolicyFilter')?.value||'ALL');
  const all=Array.isArray(lastRobotServices)?lastRobotServices:[];
  const classified=all.map(s=>({svc:s,enabled:serviceEnabled(s),policy:servicePolicyFor(s)}));
  const services=classified.filter(({svc,enabled,policy})=>{
    if(textFilter&&!String(svc?.name||'').toLowerCase().includes(textFilter))return false;
    if(stateFilter==='ON'&&enabled!==true)return false;
    if(stateFilter==='OFF'&&enabled!==false)return false;
    if(policyFilter!=='ALL'&&policy!==policyFilter)return false;
    return true;
  });
  const on=classified.filter(x=>x.enabled===true).length;
  const off=classified.filter(x=>x.enabled===false).length;
  const unknownState=all.length-on-off;
  const allowedCount=classified.filter(x=>x.policy==='ALLOWED').length;
  const protectedCount=classified.filter(x=>x.policy==='PROTECTED').length;
  const counts=$('robotServiceCounts');
  const filtering=!!textFilter||stateFilter!=='ALL'||policyFilter!=='ALL';
  if(counts)counts.textContent=`${on} on · ${off} off${unknownState?` · ${unknownState} state?`:''} · ${allowedCount} allowed · ${protectedCount} protected${filtering?` · ${services.length} shown`:''}`;
  if(!services.length){list.innerHTML=`<div class="empty">${all.length?'No services match the active filters':'No service inventory yet'}</div>`;return;}
  const workerReady=!!serviceControlConfig?.enabled&&serviceControlConfig?.worker?.status==='READY';
  for(const {svc,enabled,policy} of services){
    const row=document.createElement('div'); row.className='service-row';
    const name=document.createElement('span'); name.className='service-name'; name.textContent=String(svc?.name||'?'); name.title=name.textContent;
    const policyEl=document.createElement('span'); policyEl.className=`service-policy ${servicePolicyClassName(policy)}`; policyEl.textContent=policy==='READ_ONLY'?'READ ONLY':policy;
    if(svc?.protect)policyEl.title='Unitree RobotState protect flag is set';
    const state=document.createElement('strong');
    const rawStatus=Number(svc?.status);
    state.textContent=enabled===true?'ON':enabled===false?'OFF':`STATE ${Number.isFinite(rawStatus)?rawStatus:'—'}`;
    state.title=Number.isFinite(rawStatus)?`Unitree raw service status: ${rawStatus} (0=ON, 1=OFF)`:'unknown service state';
    if(enabled===true)state.className='good-text';else if(enabled===false)state.className='dim';else state.className='warn-text';
    const control=document.createElement('span');control.className='service-control-cell';
    if(serviceActionBusyName===name.textContent){
      const busy=document.createElement('span');busy.className='service-switching';busy.textContent='SWITCHING…';control.appendChild(busy);
    }else if(policy==='ALLOWED'&&enabled!==null){
      const label=document.createElement('label');label.className='service-switch';label.title=workerReady?'Switch service through verified RobotState action worker':'Service action worker is not ready';
      const input=document.createElement('input');input.type='checkbox';input.checked=enabled===true;input.disabled=!workerReady;
      const track=document.createElement('span');track.className='service-switch-track';
      input.addEventListener('change',()=>{
        const desired=input.checked; input.checked=enabled===true;
        requestServiceState(name.textContent,desired);
      });
      label.append(input,track);control.appendChild(label);
    }else{
      const na=document.createElement('span');na.className='service-control-na';na.textContent=policy==='PROTECTED'?'LOCKED':'—';control.appendChild(na);
    }
    row.append(name,policyEl,state,control);list.appendChild(row);
  }
}
async function postServiceState(name,enabled){
  const key=currentManagementKey();
  if(!key)throw new Error('Enter the management key first.');
  const r=await fetch('/api/services/set',{
    method:'POST',headers:{'Content-Type':'application/json','X-G1-Management-Key':key},
    body:JSON.stringify({service:name,enabled})
  });
  let body={};try{body=await r.json();}catch{}
  if(r.status===401){storeManagementKey('');showManagementKeyPrompt('Management key rejected. Enter the key printed by the currently running ./start_dashboard.sh.');}
  if(!r.ok)throw new Error(body?.service_action?.reason||body.error||`HTTP ${r.status}`);
  return body.service_action||{};
}
async function requestServiceState(name,enabled){
  if(serviceActionBusyName)return;
  const desiredWord=enabled?'ON':'OFF';
  if(!currentManagementKey()){
    showManagementKeyPrompt(`Enter the management key to switch ${name} ${desiredWord}.`,()=>requestServiceState(name,enabled));
    return;
  }
  if(!window.confirm(`Switch Unitree service "${name}" ${desiredWord}?\n\nOnly explicitly ALLOWED services can reach ServiceSwitch. The worker will re-read ServiceList and report success only if the requested state is verified.`))return;
  serviceActionBusyName=name;renderServiceList();
  try{
    const action=await postServiceState(name,enabled);
    if(action?.after){
      const idx=lastRobotServices.findIndex(s=>String(s?.name||'')===name);
      if(idx>=0)lastRobotServices[idx]={...lastRobotServices[idx],...action.after};
    }
    renderServiceList();
    await pollSystem();
  }catch(err){
    window.alert(`Service switch failed: ${err.message||err}`);
    await pollServiceControl();
    await pollSystem();
  }finally{serviceActionBusyName=null;renderServiceList();}
}
function renderBaseSensing(base){
  const imu=base?.imu||{}, odom=base?.odometry||{};
  const imuFresh=!!imu.available && finite(imu.age_s) && Number(imu.age_s)<1.0;
  const odomFresh=!!odom.available && finite(odom.age_s) && Number(odom.age_s)<1.5;
  setChip($('baseSensorChip'),imuFresh?(odomFresh?'IMU + ODOM LIVE':'IMU LIVE'):'SENSORS OFFLINE',imuFresh?'good':'warn');

  const rpy=Array.isArray(imu.rpy_rad)?imu.rpy_rad:[];
  const gyro=Array.isArray(imu.gyroscope_rps)?imu.gyroscope_rps:[];
  const acc=Array.isArray(imu.accelerometer_mps2)?imu.accelerometer_mps2:[];
  const quat=Array.isArray(imu.quaternion_wxyz)?imu.quaternion_wxyz:[];
  const rad2deg=x=>finite(x)?Number(x)*180/Math.PI:null;
  $('imuTopic').textContent=imu.topic||'rt/secondary_imu';
  $('imuRoll').textContent=n(rad2deg(rpy[0]),1,'°');
  $('imuPitch').textContent=n(rad2deg(rpy[1]),1,'°');
  $('imuYaw').textContent=n(rad2deg(rpy[2]),1,'°');
  $('imuGyroX').textContent=n(gyro[0],3);
  $('imuGyroY').textContent=n(gyro[1],3);
  $('imuGyroZ').textContent=n(gyro[2],3);
  $('imuAccelX').textContent=n(acc[0],2);
  $('imuAccelY').textContent=n(acc[1],2);
  $('imuAccelZ').textContent=n(acc[2],2);
  $('imuQuaternion').textContent=quat.length>=4?`q [${quat.slice(0,4).map(v=>finite(v)?Number(v).toFixed(3):'—').join(', ')}]`:'q —';
  const imuBits=[];
  if(finite(imu.temperature_c)) imuBits.push(`${Number(imu.temperature_c).toFixed(0)} °C`);
  if(finite(imu.age_s)) imuBits.push(`${(Number(imu.age_s)*1000).toFixed(0)} ms`);
  if(finite(imu.sample_count)) imuBits.push(`#${imu.sample_count}`);
  $('imuMeta').textContent=imuBits.join(' · ') || (imu.error||'waiting');

  const pos=Array.isArray(odom.position_m)?odom.position_m:[];
  const vel=Array.isArray(odom.velocity_mps)?odom.velocity_mps:[];
  $('odomTopic').textContent=odom.topic||'waiting';
  $('odomPosX').textContent=n(pos[0],3,' m'); $('odomPosY').textContent=n(pos[1],3,' m'); $('odomPosZ').textContent=n(pos[2],3,' m');
  $('odomVelX').textContent=n(vel[0],3,' m/s'); $('odomVelY').textContent=n(vel[1],3,' m/s'); $('odomVelZ').textContent=n(vel[2],3,' m/s');
  $('odomYawRate').textContent=`yaw rate ${n(odom.yaw_speed_rps,3,' rad/s')}`;
  const odomBits=[];
  if(finite(odom.age_s)) odomBits.push(`${(Number(odom.age_s)*1000).toFixed(0)} ms`);
  if(finite(odom.sample_count)) odomBits.push(`#${odom.sample_count}`);
  $('odomMeta').textContent=odomBits.join(' · ') || '—';
  const note=$('odomNote');
  if(odomFresh){note.textContent='Read-only odometry stream is live.'; setTone(note,'good');}
  else {note.textContent=odom.error||'Waiting for rt/odommodestate; the odometer service may be inactive.'; setTone(note,odom.error?'warn':null);}
}
function renderSystem(env){
  const mon=env?.monitor||{}; const sys=env?.system;
  const online=!!mon.online;
  setChip($('systemMonitorChip'),online?'MONITOR LIVE':'MONITOR OFFLINE',online?'good':'warn');
  $('systemAge').textContent=finite(mon.packet_age_s)?`${Number(mon.packet_age_s).toFixed(1)} s`:'—';
  if(!sys){
    $('systemHostname').textContent='PC2 monitor not running';
    renderRobotServices({enabled:false,available:false,error:'Run g1_dashboard_system_monitor.py on PC2.'});
    renderBaseSensing(null);
    return;
  }
  const host=sys.host||{}, cpu=host.cpu||{}, mem=host.memory||{}, disk=host.disk_root||{}, therm=host.thermal||{}, net=host.network||{};
  $('systemHostname').textContent=host.hostname||'PC2';
  $('systemCpu').textContent=finite(cpu.used_pct)?`${Number(cpu.used_pct).toFixed(0)}%`:'—';
  setTone($('systemCpu'),finite(cpu.used_pct)&&Number(cpu.used_pct)>=90?'bad':finite(cpu.used_pct)&&Number(cpu.used_pct)>=75?'warn':'good');
  $('systemLoad').textContent=`load ${n(cpu.load_1m,2)} / ${n(cpu.load_5m,2)} / ${n(cpu.load_15m,2)}`;
  $('systemRam').textContent=finite(mem.used_pct)?`${Number(mem.used_pct).toFixed(0)}%`:'—';
  $('systemRamDetail').textContent=`${bytes(mem.available_bytes)} free / ${bytes(mem.total_bytes)}`;
  setTone($('systemRam'),finite(mem.used_pct)&&Number(mem.used_pct)>=90?'bad':finite(mem.used_pct)&&Number(mem.used_pct)>=80?'warn':'good');
  $('systemDisk').textContent=finite(disk.used_pct)?`${Number(disk.used_pct).toFixed(0)}%`:'—';
  $('systemDiskDetail').textContent=`${bytes(disk.free_bytes)} free / ${bytes(disk.total_bytes)}`;
  setTone($('systemDisk'),finite(disk.used_pct)&&Number(disk.used_pct)>=95?'bad':finite(disk.used_pct)&&Number(disk.used_pct)>=85?'warn':'good');
  $('systemTemp').textContent=finite(therm.max_c)?`${Number(therm.max_c).toFixed(0)} °C`:'—';
  const zones=Array.isArray(therm.zones)?therm.zones:[]; $('systemTempZone').textContent=zones.length?(zones[0].name||'thermal zone'):'no thermal data';
  setTone($('systemTemp'),finite(therm.max_c)&&Number(therm.max_c)>=90?'bad':finite(therm.max_c)&&Number(therm.max_c)>=80?'warn':'good');
  $('systemUptime').textContent=duration(host.uptime_s);
  $('systemInterface').textContent=`${net.interface||'—'} · ${net.operstate||'unknown'}${net.carrier===1?' · carrier':''}`;
  setTone($('systemInterface'),net.operstate==='up'?'good':'warn');
  $('systemIpv4').textContent=net.ipv4||'—';
  $('systemTraffic').textContent=`RX ${bytes(net.rx_bytes)} · TX ${bytes(net.tx_bytes)}`;
  const ep=sys.endpoints||{}; endpointState('endpointTelevuer',!!ep.televuer_8012); endpointState('endpointCamera',!!ep.camera_60001); endpointState('endpointDashboard',!!ep.dashboard_8080);
  const pr=sys.processes||{}; processState('processController',pr.controller); processState('processTeleimager',pr.teleimager); processState('processInspire',pr.inspire);
  renderRobotServices(sys.robot_state_api||{});
  renderBaseSensing(sys.base_sensing||{});
}
$('serviceFilter')?.addEventListener('input',renderServiceList);
$('serviceStateFilter')?.addEventListener('change',renderServiceList);
$('servicePolicyFilter')?.addEventListener('change',renderServiceList);

async function ensureSlamMap(){
  if(slamMapLoaded||slamMapLoading)return;
  slamMapLoading=true;
  const overlay=$('slamOverlay');
  overlay.classList.remove('hidden');
  overlay.querySelector('strong').textContent='Loading laboratory map…';

  try{
    const response=await fetch('/api/slam/map',{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const result=slamViewer.loadAsciiPcd(await response.text());
    slamMapLoaded=true;
    $('slamMapMeta').textContent=
      `${result.points.toLocaleString()} visible points · ${result.spanX.toFixed(1)} × ${result.spanY.toFixed(1)} m`;
    overlay.classList.add('hidden');
  }catch(error){
    overlay.querySelector('strong').textContent='Laboratory map unavailable';
    overlay.querySelector('span').textContent=String(error.message||error);
    $('slamMapMeta').textContent='load failed';
  }finally{
    slamMapLoading=false;
  }
}

function setSlamInitialResult(message,tone=null){
  const element=$('slamInitialResult');
  element.textContent=message||'';
  setTone(element,tone);
}

function cancelSlamInitialSelection(){
  slamInitialSelecting=false;
  slamInitialDraft=null;
  slamViewer.clearInitialPoseSelection();

  $('slamInitialSelection').textContent='No position selected';
  $('slamInitialStartBtn').classList.remove('hidden');
  $('slamInitialConfirmBtn').classList.add('hidden');
  $('slamInitialCancelBtn').classList.add('hidden');
  $('slamInitialConfirmBtn').disabled=true;

  renderSlamInitialization(slamLatestStatus||{});
}

async function beginSlamInitialSelection(){
  if(slamInitialBusy)return;

  if(!slamMapLoaded){
    await ensureSlamMap();
    if(!slamMapLoaded){
      setSlamInitialResult(
        'The saved map must load before selecting a pose.',
        'bad'
      );
      return;
    }
  }

  if(slamLatestStatus?.localized){
    const proceed=window.confirm(
      'The robot is currently localized. Replace its current '
      +'localization with a new approximate pose?'
    );
    if(!proceed)return;
  }

  slamInitialSelecting=true;
  slamInitialDraft=null;

  $('slamInitialStartBtn').classList.add('hidden');
  $('slamInitialConfirmBtn').classList.remove('hidden');
  $('slamInitialCancelBtn').classList.remove('hidden');
  $('slamInitialConfirmBtn').disabled=true;
  $('slamInitialSelection').textContent='Click and drag on the map';
  setSlamInitialResult(
    'Click the robot position, then drag toward its forward direction.',
    'warn'
  );

  slamViewer.beginInitialPoseSelection(pose=>{
    slamInitialDraft=pose;
    $('slamInitialSelection').textContent=
      `X ${pose.x.toFixed(2)} m · Y ${pose.y.toFixed(2)} m · `
      +`heading ${(pose.yaw*180/Math.PI).toFixed(1)}°`;
    $('slamInitialConfirmBtn').disabled=false;
  });
}

async function confirmSlamInitialPose(){
  if(slamInitialBusy||!slamInitialDraft)return;

  if(!currentManagementKey()){
    showManagementKeyPrompt(
      'Enter the management key to initialize the robot pose.',
      ()=>confirmSlamInitialPose()
    );
    return;
  }

  const pose={...slamInitialDraft};
  const confirmed=window.confirm(
    `Initialize the robot at X ${pose.x.toFixed(2)} m, `
    +`Y ${pose.y.toFixed(2)} m, heading `
    +`${(pose.yaw*180/Math.PI).toFixed(1)}°?`
  );
  if(!confirmed)return;

  slamInitialBusy=true;
  $('slamInitialConfirmBtn').disabled=true;
  $('slamInitialCancelBtn').disabled=true;
  setSlamInitialResult('Sending initial pose…','warn');

  try{
    await controllerPost('/api/slam/initialize',pose);

    slamInitialSelecting=false;
    slamViewer.finishInitialPoseSelection(true);
    $('slamInitialStartBtn').classList.remove('hidden');
    $('slamInitialConfirmBtn').classList.add('hidden');
    $('slamInitialCancelBtn').classList.add('hidden');
    setSlamInitialResult(
      'Request sent. Waiting for native SLAM confirmation…',
      'warn'
    );
  }catch(error){
    setSlamInitialResult(
      `Initialization failed: ${error.message||error}`,
      'bad'
    );
    $('slamInitialConfirmBtn').disabled=false;
    $('slamInitialCancelBtn').disabled=false;
  }finally{
    slamInitialBusy=false;
  }
}

function renderSlamInitialization(status){
  slamLatestStatus=status;

  const initialization=status?.initialization||{};
  const state=String(initialization.state||'IDLE');
  const active=state==='PUBLISHED'||state==='ACCEPTED';

  if(!slamInitialSelecting){
    const start=$('slamInitialStartBtn');
    start.classList.remove('hidden');
    start.textContent=status?.localized?
      'Reset robot position':'Set robot position';
    start.disabled=(
      slamInitialBusy
      || active
      || !status?.worker_online
    );
  }

  if(slamInitialSelecting)return;

  if(state==='PUBLISHED'){
    setSlamInitialResult(
      'Initial pose published. Waiting for API 1804…',
      'warn'
    );
  }else if(state==='ACCEPTED'){
    setSlamInitialResult(
      'Native SLAM accepted the pose. Waiting for localization…',
      'warn'
    );
  }else if(state==='LOCALIZED'){
    setSlamInitialResult('Localization confirmed.','good');
    slamInitialDraft=null;
    slamViewer.clearInitialPoseSelection();
  }else if(state==='REJECTED'){
    setSlamInitialResult(
      `Initialization rejected: ${initialization.error||'unknown error'}`,
      'bad'
    );
  }else if(state==='TIMEOUT'){
    setSlamInitialResult(
      `Initialization timed out: ${initialization.error||'no fresh pose'}`,
      'bad'
    );
  }else if(!status?.worker_online){
    setSlamInitialResult('SLAM worker is offline.','bad');
  }else if(!status?.localized){
    setSlamInitialResult(
      'Select the robot’s approximate map position and heading.',
      'warn'
    );
  }else{
    setSlamInitialResult(
      'Localization is active. Reset only if the displayed pose is wrong.',
      'good'
    );
  }
}

function renderSlamStatus(status){
  const state=String(status?.state||'OFFLINE');
  const tone=state==='LOCALIZED'?'good':
    state==='UNLOCALIZED'?'warn':'bad';

  setChip($('slamStateChip'),state,tone);
  $('slamLocalizationState').textContent=state;
  setTone($('slamLocalizationState'),tone);

  const nativeMap=status?.native_map||{};
  $('slamMapIdentity').textContent=nativeMap.matches?
    'VERIFIED':'NOT VERIFIED';
  setTone($('slamMapIdentity'),nativeMap.matches?'good':'bad');

  const pose=nativeMap.matches?status?.pose:null;
  const localized=Boolean(status?.localized&&pose);
  $('slamPose').textContent=pose?
    `X ${n(pose.x,2,' m')} · Y ${n(pose.y,2,' m')}`:'—';
  $('slamYaw').textContent=pose?
    n(Number(pose.yaw)*180/Math.PI,1,'°'):'—';
  $('slamPoseSource').textContent=status?.pose_source||'—';

  slamViewer.setRobotPose(pose,localized);
  renderSlamInitialization(status);

  const cloud=status?.cloud||{};
  const cloudText=cloud.online?
    `${Number(cloud.points||0).toLocaleString()} pts · #${cloud.sequence}`:
    cloud.sequence?
      `STALE · ${(Number(cloud.age_s)||0).toFixed(1)} s`:
      'WAITING';
  $('slamCloudMeta').textContent=cloudText;
  setTone($('slamCloudMeta'),cloud.online?'good':cloud.sequence?'warn':null);
  slamViewer.setLiveFresh(Boolean(cloud.online));

  if(
    currentView==='slam'
    && Number(cloud.sequence)>0
    && Number(cloud.sequence)!==slamLastCloudSequence
  ){
    fetchSlamCloud(Number(cloud.sequence));
  }
}

async function fetchSlamCloud(sequence){
  if(slamCloudBusy)return;
  slamCloudBusy=true;
  try{
    const response=await fetch(
      `/api/slam/cloud?sequence=${encodeURIComponent(sequence)}`,
      {cache:'no-store'}
    );
    if(response.status===204)return;
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    slamViewer.setLiveCloud(await response.arrayBuffer());
    slamLastCloudSequence=sequence;
  }catch(error){
    console.debug('SLAM cloud unavailable',error);
  }finally{
    slamCloudBusy=false;
  }
}

async function pollSlamStatus(){
  if(slamStatusBusy)return;
  slamStatusBusy=true;
  try{
    const response=await fetch('/api/slam/status',{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    renderSlamStatus(await response.json());
  }catch(error){
    setChip($('slamStateChip'),'SLAM OFFLINE','bad');
    // Preserve the last verified pose during a transient HTTP failure.
    slamViewer.setLiveFresh(false);
  }finally{
    slamStatusBusy=false;
  }
}

$('slamResetView').addEventListener('click',()=>slamViewer.resetView());
$('slamInitialStartBtn').addEventListener(
  'click',
  ()=>beginSlamInitialSelection()
);
$('slamInitialConfirmBtn').addEventListener(
  'click',
  ()=>confirmSlamInitialPose()
);
$('slamInitialCancelBtn').addEventListener(
  'click',
  ()=>cancelSlamInitialSelection()
);
$('slamMapToggle').addEventListener('change',event=>
  slamViewer.setMapEnabled(event.target.checked));
$('slamLiveToggle').addEventListener('change',event=>
  slamViewer.setLiveEnabled(event.target.checked));
$('slamRobotToggle').addEventListener('change',event=>
  slamViewer.setRobotEnabled(event.target.checked));

let systemBusy=false;
async function pollSystem(){
  if(systemBusy)return; systemBusy=true;
  try{const r=await fetch('/api/system',{cache:'no-store'}); if(!r.ok)throw new Error(`HTTP ${r.status}`); renderSystem(await r.json());}
  catch(err){setChip($('systemMonitorChip'),'MONITOR OFFLINE','warn'); console.debug('system monitor unavailable',err);}
  finally{systemBusy=false;}
}

let poseBusy=false;
let lastPoseSeq=-1;
let lastPoseSource=0;
function updatePoseHud(){
  const st=G1Twin.getStats();
  $('poseAgeStat').textContent=finite(st.sourceAgeMs)?`${Math.round(st.sourceAgeMs)} ms`:'—';
  $('poseRxStat').textContent=finite(st.rxHz)?`${st.rxHz.toFixed(1)} Hz`:'—';
  $('poseFpsStat').textContent=finite(st.fps)?`${Math.round(st.fps)} FPS`:'—';
  $('poseSeqStat').textContent=st.sequence==null?'—':String(st.sequence);
}
async function pollPose(){
  if(poseBusy)return; poseBusy=true; const started=performance.now();
  try{
    const r=await fetch('/api/pose',{cache:'no-store'}); if(!r.ok)throw new Error(`HTTP ${r.status}`); const pose=await r.json();
    renderHandsFromPose(pose);
    const seq=Number(pose.sequence), src=Number(pose.source_unix_time_s);
    const controllerRestart = Number.isFinite(seq) && seq < lastPoseSeq && Number.isFinite(src) && src > lastPoseSource + 0.5;
    if(Number.isFinite(seq)&&(seq>lastPoseSeq||controllerRestart)){ lastPoseSeq=seq; if(Number.isFinite(src))lastPoseSource=src; G1Twin.updatePose(pose); }
  }catch(err){ console.debug('pose fast path unavailable',err); }
  finally{ poseBusy=false; const wait=Math.max(0,(1000/30)-(performance.now()-started)); setTimeout(pollPose,wait); }
}
async function poll(){
  if(pollBusy)return; pollBusy=true;
  try{ const r=await fetch('/api/latest',{cache:'no-store'}); if(!r.ok)throw new Error(`HTTP ${r.status}`); render(await r.json()); updatePoseHud(); }
  catch(err){ console.error('dashboard status poll failed',err); }
  finally{pollBusy=false;}
}



/* ================================================================
   STITCH_CAMERA_CLICK_TITLE_V147

   Runs INSIDE the real dashboard IIFE.

   Purpose:
     - keep six static camera dock controls enabled on localhost:8081
     - decorate real camera headers with icon + centered title

   Existing Dragos click handler remains authoritative.
   ================================================================ */


function stitchCameraIconV147(id){

  /* STITCH_CAMERA_ICON_FUNCTION_V152 */

  const icons = {

    rgb: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="6.5" width="17" height="12" rx="2.2"/>
        <circle cx="12" cy="12.5" r="4"/>
        <circle cx="12" cy="12.5" r="1.6"/>
        <path d="M8 6.5l1.4-2h5.2l1.4 2"/>
      </svg>
    `,

    depth: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.5l8 4.2-8 4.2-8-4.2 8-4.2Z"/>
        <path d="M5 11.2l7 3.7 7-3.7"/>
        <path d="M5 15.5l7 4 7-4"/>
        <path d="M12 7.7v7.2"/>
      </svg>
    `,

    overlay: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="5" width="11.5" height="11.5" rx="1.8"/>
        <rect x="9" y="8" width="11.5" height="11.5" rx="1.8"/>
        <circle cx="9.3" cy="10.8" r="2.5"/>
        <path d="M13 15l2-2 3 3"/>
      </svg>
    `,

    disparity: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2.8" y="6.5" width="7.4" height="11" rx="1.4"/>
        <rect x="13.8" y="6.5" width="7.4" height="11" rx="1.4"/>
        <path d="M8 12h8"/>
        <path d="M11 9l-3 3 3 3"/>
        <path d="M13 9l3 3-3 3"/>
      </svg>
    `,

    pointcloud: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="7" cy="7" r="1"/>
        <circle cx="12.5" cy="5" r="1"/>
        <circle cx="17.5" cy="8" r="1"/>
        <circle cx="9" cy="11" r="1"/>
        <circle cx="15" cy="12" r="1"/>
        <circle cx="18.5" cy="15.5" r="1"/>
        <circle cx="11.5" cy="16.5" r="1"/>
        <path d="M5 19h6"/>
        <path d="M5 19v-6"/>
        <path d="M5 19l4-4"/>
      </svg>
    `,

    lifecam: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="4.5" width="14" height="13" rx="4"/>
        <circle cx="12" cy="11" r="3.8"/>
        <circle cx="12" cy="11" r="1.5"/>
        <path d="M9 17.5v2h6v-2"/>
        <path d="M8 20h8"/>
      </svg>
    `,
  };


  return icons[id] || '';
}


function stitchCameraDecorateHeaderV147(
  tile,
  id
){

  if(!tile){
    return;
  }


  const header =
    tile.querySelector(
      '.camera-tile-head'
    );


  if(!header){
    return;
  }


  if(
    header.querySelector(
      ':scope > .stitch-camera-title-v147'
    )
  ){
    return;
  }


  /*
   * REAL header DOM:
   *
   *   <div class="camera-tile-head">
   *       <strong>TITLE</strong>
   *       <div>STATE / CERT</div>
   *   </div>
   */
  const title =
    header.querySelector(
      ':scope > strong'
    );


  if(!title){
    return;
  }


  const wrapper =
    document.createElement(
      'div'
    );


  wrapper.className =
    'stitch-camera-title-v147';


  const icon =
    document.createElement(
      'span'
    );


  icon.className =
    'stitch-camera-title-icon-v147';


  icon.innerHTML =
    stitchCameraIconV147(id);


  header.insertBefore(
    wrapper,
    title
  );


  wrapper.appendChild(
    icon
  );


  wrapper.appendChild(
    title
  );
}


function stitchCameraRefreshV147(){

  /*
   * Static secondary-PC design preview:
   * these controls are local visual window toggles.
   */
  if(
    stitchCameraUiPreviewV142()
  ){

    document
      .querySelectorAll(
        '#view-live [data-camera-mode]'
      )
      .forEach(button=>{

        const id =
          button.dataset.cameraMode;


        const active =
          activeCameraViews.includes(
            id
          );


        button.disabled =
          false;


        button.classList.toggle(
          'active',
          active
        );


        button.setAttribute(
          'aria-pressed',
          active
            ? 'true'
            : 'false'
        );
      });
  }


  for(
    const id
    of CAMERA_VIEW_ORDER
  ){

    stitchCameraDecorateHeaderV147(
      cameraTileElement(id),
      id
    );
  }
}



/* ================================================================
   STITCH_CAMERA_D15_V151

   Six-window adaptation of the real Bacalbasa D7H + D15 system.

   WORKSPACE -> WORKSPACE
       drag the real whole window
       fixed slots highlight
       stationary windows jiggle
       occupied target = swap
       empty target = move
       290ms FLIP settle

   WORKSPACE -> DOCK
       drag the real whole window into the horizontal icon dock
       window is parked
       its workspace position becomes empty
       corresponding icon becomes green

   DOCK -> WORKSPACE
       only PARKED icons are draggable
       exact D15-style icon/title ghost
       only EMPTY positions are legal
       green restore target
       real tile is restored into selected position

   Ordinary icon clicks are retired.

   No MutationObserver.
   No setInterval.
   ================================================================ */


let stitchCameraPendingV151 =
    null;


let stitchCameraDragV151 =
    null;


let stitchCameraIconDragV151 =
    null;


let stitchCameraParkingV151 =
    null;


/*
 * id -> 0..5 while on workspace.
 *
 * Parked windows have null.
 */
const stitchCameraSlotByIdV151 =
    new Map();


const stitchCameraParkedV151 =
    new Set();


/* ================================================================
   BASIC HELPERS
   ================================================================ */

function stitchCameraIdV151(
    tile
){

    return (
        tile?.dataset?.cameraViewTile
        ||
        null
    );
}


function stitchCameraStageV151(){

    return document.getElementById(
        'cameraStage'
    );
}


function stitchCameraDockV151(){

    return document.querySelector(
        '#view-live .camera-mode-buttons'
    );
}


function stitchCameraEnsureParkingV151(){

    if(
        stitchCameraParkingV151
        &&
        stitchCameraParkingV151.isConnected
    ){
        return stitchCameraParkingV151;
    }


    stitchCameraParkingV151 =
        document.getElementById(
            'stitchCameraParkingV151'
        );


    if(
        !stitchCameraParkingV151
    ){

        stitchCameraParkingV151 =
            document.createElement(
                'div'
            );


        stitchCameraParkingV151.id =
            'stitchCameraParkingV151';


        stitchCameraParkingV151.setAttribute(
            'aria-hidden',
            'true'
        );


        document.body.appendChild(
            stitchCameraParkingV151
        );
    }


    return stitchCameraParkingV151;
}


function stitchCameraTileForIdV151(
    id
){

    return cameraTileElement(
        id
    );
}


/* ================================================================
   INITIAL SIX-SLOT MODEL

       0 | 1
       -----
       2 | 3
       -----
       4 | 5

   Current visible window order is preserved on first initialization.
   ================================================================ */

function stitchCameraInitializeSlotsV151(){

    if(
        stitchCameraSlotByIdV151.size
    ){
        return;
    }


    const stage =
        stitchCameraStageV151();


    if(!stage){
        return;
    }


    const active =
        new Set(
            activeCameraViews
        );


    const orderedWorkspaceIds =
        [
            ...stage.querySelectorAll(
                ':scope > .camera-tile'
            )
        ]
        .map(
            stitchCameraIdV151
        )
        .filter(
            id =>
                id
                &&
                active.has(id)
        );


    /*
     * Include active IDs whose tile may not have been in DOM order
     * for some reason.
     */
    for(
        const id
        of CAMERA_VIEW_ORDER
    ){

        if(
            active.has(id)
            &&
            !orderedWorkspaceIds.includes(
                id
            )
        ){
            orderedWorkspaceIds.push(
                id
            );
        }
    }


    let slot =
        0;


    for(
        const id
        of orderedWorkspaceIds
    ){

        if(
            slot >= 6
        ){
            break;
        }


        stitchCameraSlotByIdV151.set(
            id,
            slot
        );


        stitchCameraParkedV151.delete(
            id
        );


        slot += 1;
    }


    /*
     * Every currently inactive window starts in the dock.
     */
    for(
        const id
        of CAMERA_VIEW_ORDER
    ){

        if(
            stitchCameraSlotByIdV151.has(
                id
            )
        ){
            continue;
        }


        stitchCameraSlotByIdV151.set(
            id,
            null
        );


        stitchCameraParkedV151.add(
            id
        );


        const tile =
            stitchCameraTileForIdV151(
                id
            );


        if(tile){

            tile.classList.add(
                'hidden',
                'stitch-camera-parked-v151'
            );


            stitchCameraEnsureParkingV151()
                .appendChild(
                    tile
                );
        }
    }
}


/* ================================================================
   SLOT OCCUPANCY
   ================================================================ */

function stitchCameraOccupantV151(
    slotIndex,
    excludeId = null
){

    for(
        const [
            id,
            slot
        ]
        of stitchCameraSlotByIdV151
    ){

        if(
            id !== excludeId
            &&
            slot === slotIndex
            &&
            !stitchCameraParkedV151.has(
                id
            )
        ){
            return id;
        }
    }


    return null;
}


function stitchCameraSlotEmptyV151(
    slotIndex,
    excludeId = null
){

    return (
        stitchCameraOccupantV151(
            slotIndex,
            excludeId
        )
        === null
    );
}


/* ================================================================
   APPLY REAL 2×3 WORKSPACE POSITIONS
   ================================================================ */

function stitchCameraApplyLayoutV151(){

    const stage =
        stitchCameraStageV151();


    if(!stage){
        return;
    }


    stage.dataset.count =
        '6';


    for(
        const id
        of CAMERA_VIEW_ORDER
    ){

        const tile =
            stitchCameraTileForIdV151(
                id
            );


        if(!tile){
            continue;
        }


        if(
            stitchCameraParkedV151.has(
                id
            )
        ){

            tile.classList.add(
                'hidden',
                'stitch-camera-parked-v151'
            );


            if(
                tile.parentElement
                !==
                stitchCameraEnsureParkingV151()
            ){

                stitchCameraEnsureParkingV151()
                    .appendChild(
                        tile
                    );
            }


            continue;
        }


        const slot =
            stitchCameraSlotByIdV151.get(
                id
            );


        if(
            !Number.isInteger(slot)
        ){
            continue;
        }


        if(
            tile.parentElement !== stage
        ){

            stage.appendChild(
                tile
            );
        }


        tile.classList.remove(
            'hidden',
            'stitch-camera-parked-v151'
        );


        tile.style.gridColumn =
            String(
                slot % 2 + 1
            );


        tile.style.gridRow =
            String(
                Math.floor(
                    slot / 2
                )
                + 1
            );
    }


    stitchCameraSyncDockV151();
}


/* ================================================================
   D15 DOCK STATE

   Exact Bacalbasa distinction:
       on workspace = quiet
       parked       = green / draggable
   ================================================================ */

function stitchCameraSyncDockV151(){

    for(
        const button
        of document.querySelectorAll(
            '#view-live [data-camera-mode]'
        )
    ){

        const id =
            button.dataset.cameraMode;


        if(
            !CAMERA_VIEWS[id]
        ){
            continue;
        }


        const parked =
            stitchCameraParkedV151.has(
                id
            );


        button.classList.toggle(
            'stitch-camera-is-parked-v151',
            parked
        );


        button.classList.toggle(
            'stitch-camera-on-workspace-v151',
            !parked
        );


        /*
         * D15 availability is based on the existence of the real tile,
         * not backend controllability.
         */
        button.disabled =
            !stitchCameraTileForIdV151(
                id
            );


        button.title =
            parked
            ?
            `Drag ${CAMERA_VIEWS[id].label} into an empty workspace position`
            :
            `${CAMERA_VIEWS[id].label} is currently on the workspace`;
    }
}


/* ================================================================
   KEEP D15 PRESENTATION AUTHORITATIVE AFTER NORMAL CAMERA RENDERS
   ================================================================ */

function stitchCameraDockSyncV151(){

    if(
        !stitchCameraSlotByIdV151.size
    ){
        stitchCameraInitializeSlotsV151();
    }


    stitchCameraApplyLayoutV151();
}


/* ================================================================
   SLOT OVERLAY

   Real fixed positions, independent of windows.
   ================================================================ */

function stitchCameraCreateSlotLayerV151(
    mode,
    sourceId = null
){

    const stage =
        stitchCameraStageV151();


    if(!stage){
        return {
            layer:
                null,

            slots:
                [],
        };
    }


    document
        .querySelector(
            '.stitch-camera-slot-layer-v151'
        )
        ?.remove();


    const layer =
        document.createElement(
            'div'
        );


    layer.className =
        `stitch-camera-slot-layer-v151 stitch-camera-slot-mode-${mode}-v151`;


    const computed =
        getComputedStyle(
            stage
        );


    layer.style.gridTemplateColumns =
        computed.gridTemplateColumns;


    layer.style.gridTemplateRows =
        computed.gridTemplateRows;


    layer.style.columnGap =
        computed.columnGap;


    layer.style.rowGap =
        computed.rowGap;


    layer.style.padding =
        computed.padding;


    stage.appendChild(
        layer
    );


    const slots = [];


    for(
        let index = 0;
        index < 6;
        index += 1
    ){

        const element =
            document.createElement(
                'div'
            );


        element.className =
            'stitch-camera-slot-v151';


        element.dataset.slotIndex =
            String(
                index
            );


        const empty =
            stitchCameraSlotEmptyV151(
                index,
                sourceId
            );


        const available =
            (
                mode === 'window'
                ||
                empty
            );


        element.classList.toggle(
            'stitch-camera-slot-available-v151',
            available
        );


        element.classList.toggle(
            'stitch-camera-slot-unavailable-v151',
            !available
        );


        layer.appendChild(
            element
        );


        slots.push({

            index,

            element,

            available,
        });
    }


    return {
        layer,
        slots,
    };
}


function stitchCameraRemoveSlotLayerV151(){

    document
        .querySelector(
            '.stitch-camera-slot-layer-v151'
        )
        ?.remove();
}


function stitchCameraSlotAtPointV151(
    slots,
    x,
    y,
    availableOnly = false
){

    for(
        const slot
        of slots || []
    ){

        if(
            availableOnly
            &&
            !slot.available
        ){
            continue;
        }


        const rect =
            slot.element
                .getBoundingClientRect();


        if(
            x >= rect.left
            &&
            x <= rect.right
            &&
            y >= rect.top
            &&
            y <= rect.bottom
        ){
            return slot;
        }
    }


    return null;
}


function stitchCameraSetSlotTargetV151(
    slots,
    target,
    restore = false
){

    for(
        const slot
        of slots || []
    ){

        slot.element.classList.toggle(
            restore
                ?
                'stitch-camera-restore-target-v151'
                :
                'stitch-camera-slot-target-v151',
            slot === target
        );
    }
}


/* ================================================================
   BACALBASA JIGGLE — ALL STATIONARY WINDOWS
   ================================================================ */

function stitchCameraStartJiggleV151(
    sourceTile
){

    const animations = [];


    let index =
        0;


    for(
        const id
        of CAMERA_VIEW_ORDER
    ){

        if(
            stitchCameraParkedV151.has(
                id
            )
        ){
            continue;
        }


        const tile =
            stitchCameraTileForIdV151(
                id
            );


        if(
            !tile
            ||
            tile === sourceTile
        ){
            continue;
        }


        const reverse =
            index % 2 === 1;


        try{

            animations.push(

                tile.animate(
                    reverse
                    ?
                    [
                        {
                            transform:
                                'rotate(0.18deg) translateY(0.4px)'
                        },
                        {
                            transform:
                                'rotate(-0.18deg) translateY(-0.4px)'
                        }
                    ]
                    :
                    [
                        {
                            transform:
                                'rotate(-0.18deg) translateY(-0.4px)'
                        },
                        {
                            transform:
                                'rotate(0.18deg) translateY(0.4px)'
                        }
                    ],
                    {
                        duration:
                            210,

                        easing:
                            'ease-in-out',

                        direction:
                            'alternate',

                        iterations:
                            Infinity,
                    }
                )
            );

        }
        catch(_){
        }


        index += 1;
    }


    return animations;
}


function stitchCameraStopJiggleV151(
    animations
){

    for(
        const animation
        of animations || []
    ){

        try{

            animation.cancel();

        }
        catch(_){
        }
    }
}


/* ================================================================
   FLIP
   ================================================================ */

function stitchCameraCaptureRectsV151(){

    const before =
        new Map();


    for(
        const id
        of CAMERA_VIEW_ORDER
    ){

        if(
            stitchCameraParkedV151.has(
                id
            )
        ){
            continue;
        }


        const tile =
            stitchCameraTileForIdV151(
                id
            );


        if(tile){

            before.set(
                tile,
                tile.getBoundingClientRect()
            );
        }
    }


    return before;
}


function stitchCameraFlipV151(
    before
){

    for(
        const [
            tile,
            oldRect
        ]
        of before
    ){

        if(
            !tile.isConnected
            ||
            tile.classList.contains(
                'hidden'
            )
        ){
            continue;
        }


        const rect =
            tile.getBoundingClientRect();


        const dx =
            oldRect.left
            -
            rect.left;


        const dy =
            oldRect.top
            -
            rect.top;


        if(
            Math.abs(dx) < 1
            &&
            Math.abs(dy) < 1
        ){
            continue;
        }


        try{

            tile.animate(
                [
                    {
                        transform:
                            `translate3d(${dx}px, ${dy}px, 0) scale(0.985)`
                    },
                    {
                        transform:
                            'translate3d(0,0,0) scale(1)'
                    }
                ],
                {
                    duration:
                        290,

                    easing:
                        'cubic-bezier(0.2, 0.85, 0.25, 1)',

                    fill:
                        'both',
                }
            );

        }
        catch(_){
        }
    }
}


/* ================================================================
   OPTIONAL LOCAL PREVIEW VIEW-STATE SYNC

   Real Bacalbasa D15 itself does NOT change robot/API behavior.

   On localhost:8081 only, keep the existing mock view state aligned
   so restored views receive the same local demo semantics as before.
   ================================================================ */

function stitchCameraLocalViewStateV151(
    id,
    shouldBeActive
){

    if(
        !stitchCameraUiPreviewV142()
    ){
        return;
    }


    const active =
        activeCameraViews.includes(
            id
        );


    if(
        active === shouldBeActive
    ){
        return;
    }


    /*
     * Preserve existing local preview invariant:
     * do not ask toggleCameraView() to remove the final active feed.
     */
    if(
        !shouldBeActive
        &&
        activeCameraViews.length <= 1
    ){
        return;
    }


    Promise.resolve(
        toggleCameraView(
            id
        )
    )
    .finally(
        ()=>{
            stitchCameraDockSyncV151();
        }
    );
}


/* ================================================================
   PARK REAL TILE
   ================================================================ */

function stitchCameraParkV151(
    id
){

    const tile =
        stitchCameraTileForIdV151(
            id
        );


    if(
        !tile
        ||
        stitchCameraParkedV151.has(
            id
        )
    ){
        return;
    }


    stitchCameraParkedV151.add(
        id
    );


    stitchCameraSlotByIdV151.set(
        id,
        null
    );


    tile.classList.add(
        'hidden',
        'stitch-camera-parked-v151'
    );


    tile.style.removeProperty(
        'grid-column'
    );


    tile.style.removeProperty(
        'grid-row'
    );


    stitchCameraEnsureParkingV151()
        .appendChild(
            tile
        );


    stitchCameraApplyLayoutV151();


    stitchCameraLocalViewStateV151(
        id,
        false
    );
}


/* ================================================================
   RESTORE REAL TILE INTO EMPTY SLOT
   ================================================================ */

function stitchCameraRestoreV151(
    id,
    slotIndex
){

    if(
        !stitchCameraParkedV151.has(
            id
        )
        ||
        !stitchCameraSlotEmptyV151(
            slotIndex,
            id
        )
    ){
        return false;
    }


    const tile =
        stitchCameraTileForIdV151(
            id
        );


    const stage =
        stitchCameraStageV151();


    if(
        !tile
        ||
        !stage
    ){
        return false;
    }


    stitchCameraParkedV151.delete(
        id
    );


    stitchCameraSlotByIdV151.set(
        id,
        slotIndex
    );


    stage.appendChild(
        tile
    );


    tile.classList.remove(
        'hidden',
        'stitch-camera-parked-v151'
    );


    stitchCameraApplyLayoutV151();


    stitchCameraLocalViewStateV151(
        id,
        true
    );


    return true;
}


/* ================================================================
   WINDOW DRAG START
   ================================================================ */

function stitchCameraBeginWindowDragV151(
    event,
    pending
){

    if(
        !pending
        ||
        stitchCameraDragV151
        ||
        stitchCameraIconDragV151
    ){
        return;
    }


    clearTimeout(
        pending.timer
    );


    const id =
        stitchCameraIdV151(
            pending.tile
        );


    const slot =
        stitchCameraSlotByIdV151.get(
            id
        );


    if(
        !id
        ||
        !Number.isInteger(slot)
    ){
        stitchCameraPendingV151 =
            null;

        return;
    }


    const overlay =
        stitchCameraCreateSlotLayerV151(
            'window',
            id
        );


    stitchCameraDragV151 = {

        pointerId:
            event.pointerId,

        id,

        tile:
            pending.tile,

        header:
            pending.header,

        startX:
            pending.startX,

        startY:
            pending.startY,

        originSlot:
            slot,

        slots:
            overlay.slots,

        targetSlot:
            null,

        targetDock:
            false,

        jiggles:
            stitchCameraStartJiggleV151(
                pending.tile
            ),
    };


    stitchCameraPendingV151 =
        null;


    pending.tile.classList.add(
        'stitch-camera-dragging-v151'
    );


    stitchCameraStageV151()
        ?.classList.add(
            'stitch-camera-arranging-v151'
        );


    stitchCameraSetSlotTargetV151(
        overlay.slots,
        overlay.slots[
            slot
        ]
        || null
    );


    try{

        pending.header.setPointerCapture(
            event.pointerId
        );

    }
    catch(_){
    }
}


/* ================================================================
   WINDOW DRAG MOVE

   Entire real window follows pointer.
   Entire horizontal icon dock is valid parking target.
   ================================================================ */

function stitchCameraMoveWindowV151(
    event
){

    const drag =
        stitchCameraDragV151;


    if(
        !drag
        ||
        event.pointerId
            !== drag.pointerId
    ){
        return;
    }


    event.preventDefault();


    const dx =
        event.clientX
        -
        drag.startX;


    const dy =
        event.clientY
        -
        drag.startY;


    drag.tile.style.setProperty(
        '--stitch-camera-drag-x',
        `${dx}px`
    );


    drag.tile.style.setProperty(
        '--stitch-camera-drag-y',
        `${dy}px`
    );


    const dock =
        stitchCameraDockV151();


    const dockRect =
        dock?.getBoundingClientRect();


    const overDock =
        Boolean(
            dockRect
            &&
            event.clientX >= dockRect.left
            &&
            event.clientX <= dockRect.right
            &&
            event.clientY >= dockRect.top
            &&
            event.clientY <= dockRect.bottom
        );


    drag.targetDock =
        overDock;


    dock?.classList.toggle(
        'stitch-camera-dock-drop-v151',
        overDock
    );


    if(
        overDock
    ){

        stitchCameraSetSlotTargetV151(
            drag.slots,
            null
        );


        drag.targetSlot =
            null;


        return;
    }


    const target =
        stitchCameraSlotAtPointV151(
            drag.slots,
            event.clientX,
            event.clientY,
            false
        );


    stitchCameraSetSlotTargetV151(
        drag.slots,
        target
    );


    drag.targetSlot =
        target;
}


/* ================================================================
   WINDOW DRAG FINISH
   ================================================================ */

function stitchCameraFinishWindowV151(
    event
){

    if(
        stitchCameraPendingV151
        &&
        event.pointerId
            === stitchCameraPendingV151.pointerId
    ){

        clearTimeout(
            stitchCameraPendingV151.timer
        );


        stitchCameraPendingV151 =
            null;
    }


    const drag =
        stitchCameraDragV151;


    if(
        !drag
        ||
        event.pointerId
            !== drag.pointerId
    ){
        return;
    }


    stitchCameraStopJiggleV151(
        drag.jiggles
    );


    const before =
        stitchCameraCaptureRectsV151();


    stitchCameraDockV151()
        ?.classList.remove(
            'stitch-camera-dock-drop-v151'
        );


    /*
     * D15: whole window -> dock.
     */
    if(
        drag.targetDock
    ){

        stitchCameraRemoveSlotLayerV151();


        drag.tile.classList.remove(
            'stitch-camera-dragging-v151'
        );


        drag.tile.style.removeProperty(
            '--stitch-camera-drag-x'
        );


        drag.tile.style.removeProperty(
            '--stitch-camera-drag-y'
        );


        stitchCameraStageV151()
            ?.classList.remove(
                'stitch-camera-arranging-v151'
            );


        stitchCameraDragV151 =
            null;


        stitchCameraParkV151(
            drag.id
        );


        try{

            drag.header.releasePointerCapture(
                event.pointerId
            );

        }
        catch(_){
        }


        return;
    }


    /*
     * Normal workspace rearrangement.
     */
    if(
        drag.targetSlot
    ){

        const targetIndex =
            drag.targetSlot.index;


        if(
            targetIndex
            !== drag.originSlot
        ){

            const occupantId =
                stitchCameraOccupantV151(
                    targetIndex,
                    drag.id
                );


            if(
                occupantId
            ){

                stitchCameraSlotByIdV151.set(
                    occupantId,
                    drag.originSlot
                );
            }


            stitchCameraSlotByIdV151.set(
                drag.id,
                targetIndex
            );
        }
    }


    stitchCameraRemoveSlotLayerV151();


    drag.tile.classList.remove(
        'stitch-camera-dragging-v151'
    );


    drag.tile.style.removeProperty(
        '--stitch-camera-drag-x'
    );


    drag.tile.style.removeProperty(
        '--stitch-camera-drag-y'
    );


    stitchCameraStageV151()
        ?.classList.remove(
            'stitch-camera-arranging-v151'
        );


    try{

        drag.header.releasePointerCapture(
            event.pointerId
        );

    }
    catch(_){
    }


    stitchCameraDragV151 =
        null;


    stitchCameraApplyLayoutV151();


    stitchCameraFlipV151(
        before
    );
}


/* ================================================================
   DOCK ICON GHOST — SAME D15 CONCEPT
   ================================================================ */

function stitchCameraCreateDockGhostV151(
    id
){

    const ghost =
        document.createElement(
            'div'
        );


    ghost.className =
        'stitch-camera-d15-ghost-v151';


    ghost.innerHTML =
        `
        <span class="stitch-camera-d15-ghost-icon-v151">
            ${stitchCameraIconV147(id)}
        </span>

        <strong>
            ${CAMERA_VIEWS[id]?.label || id}
        </strong>
        `;


    document.body.appendChild(
        ghost
    );


    return ghost;
}


function stitchCameraPositionDockGhostV151(
    ghost,
    x,
    y
){

    if(!ghost){
        return;
    }


    ghost.style.left =
        `${x}px`;


    ghost.style.top =
        `${y}px`;
}


/* ================================================================
   DOCK ICON DRAG START

   Only green/PARKED icons drag.
   ================================================================ */

function stitchCameraBeginIconDragV151(
    event,
    button
){

    const id =
        button.dataset.cameraMode;


    if(
        !id
        ||
        !stitchCameraParkedV151.has(
            id
        )
    ){
        return;
    }


    event.preventDefault();

    event.stopImmediatePropagation();


    const overlay =
        stitchCameraCreateSlotLayerV151(
            'restore',
            id
        );


    const ghost =
        stitchCameraCreateDockGhostV151(
            id
        );


    const jiggle =
        stitchCameraStartCleanJiggleV1953(
            null
        );


    stitchCameraIconDragV151 = {

        pointerId:
            event.pointerId,

        id,

        button,

        ghost,

        jiggle,

        slots:
            overlay.slots,

        targetSlot:
            null,
    };


    document.body.classList.add(
        'stitch-camera-d15-restoring-v151'
    );


    stitchCameraPositionDockGhostV151(
        ghost,
        event.clientX,
        event.clientY
    );


    try{

        button.setPointerCapture(
            event.pointerId
        );

    }
    catch(_){
    }
}


/* ================================================================
   DOCK ICON MOVE
   ================================================================ */

function stitchCameraMoveIconV151(
    event
){

    const drag =
        stitchCameraIconDragV151;


    if(
        !drag
        ||
        event.pointerId
            !== drag.pointerId
    ){
        return;
    }


    event.preventDefault();


    stitchCameraPositionDockGhostV151(
        drag.ghost,
        event.clientX,
        event.clientY
    );


    const slot =
        stitchCameraSlotAtPointV151(
            drag.slots,
            event.clientX,
            event.clientY,
            true
        );


    stitchCameraSetSlotTargetV151(
        drag.slots,
        slot,
        true
    );


    drag.targetSlot =
        slot;
}


/* ================================================================
   DOCK ICON FINISH
   ================================================================ */

function stitchCameraFinishIconV151(
    event
){

    const drag =
        stitchCameraIconDragV151;


    if(
        !drag
        ||
        event.pointerId
            !== drag.pointerId
    ){
        return;
    }


    if(
        drag.targetSlot
        &&
        drag.targetSlot.available
    ){

        stitchCameraRestoreV151(
            drag.id,
            drag.targetSlot.index
        );
    }


    stitchCameraStopJiggleV151(
        drag.jiggle
    );


    stitchCameraRemoveSlotLayerV151();


    drag.ghost?.remove();


    document.body.classList.remove(
        'stitch-camera-d15-restoring-v151'
    );


    try{

        drag.button.releasePointerCapture(
            event.pointerId
        );

    }
    catch(_){
    }


    stitchCameraIconDragV151 =
        null;


    stitchCameraSyncDockV151();
}


/* ================================================================
   INPUT — WINDOW HEADER
   ================================================================ */

document.addEventListener(
    'pointerdown',
    event=>{

        if(
            event.button !== 0
        ){
            return;
        }


        /*
         * D15 icon drag has priority.
         */
        const dockButton =
            event.target.closest(
                '#view-live .stitch-camera-dock-btn[data-camera-mode]'
            );


        if(
            dockButton
            &&
            stitchCameraParkedV151.has(
                dockButton.dataset.cameraMode
            )
        ){

            stitchCameraBeginIconDragV151(
                event,
                dockButton
            );


            return;
        }


        const header =
            event.target.closest(
                '#view-live .camera-tile-head'
            );


        if(
            !header
            ||
            event.target.closest(
                'a, button, input, select, label'
            )
        ){
            return;
        }


        const tile =
            header.closest(
                '#view-live .camera-tile'
            );


        const id =
            stitchCameraIdV151(
                tile
            );


        if(
            !tile
            ||
            !id
            ||
            stitchCameraParkedV151.has(
                id
            )
        ){
            return;
        }


        const pending = {

            pointerId:
                event.pointerId,

            tile,

            header,

            startX:
                event.clientX,

            startY:
                event.clientY,

            timer:
                null,
        };


        pending.timer =
            setTimeout(
                ()=>{

                    stitchCameraBeginWindowDragV151(
                        event,
                        pending
                    );

                },
                115
            );


        stitchCameraPendingV151 =
            pending;
    },
    true
);


/* ================================================================
   INPUT — MOVE
   ================================================================ */

document.addEventListener(
    'pointermove',
    event=>{

        if(
            stitchCameraIconDragV151
        ){

            stitchCameraMoveIconV151(
                event
            );


            return;
        }


        if(
            stitchCameraDragV151
        ){

            stitchCameraMoveWindowV151(
                event
            );


            return;
        }


        const pending =
            stitchCameraPendingV151;


        if(
            !pending
            ||
            event.pointerId
                !== pending.pointerId
        ){
            return;
        }


        const dx =
            event.clientX
            -
            pending.startX;


        const dy =
            event.clientY
            -
            pending.startY;


        if(
            Math.hypot(
                dx,
                dy
            ) > 6
        ){

            stitchCameraBeginWindowDragV151(
                event,
                pending
            );


            stitchCameraMoveWindowV151(
                event
            );
        }
    },
    {
        passive:
            false,

        capture:
            true,
    }
);


/* ================================================================
   INPUT — UP / CANCEL
   ================================================================ */

document.addEventListener(
    'pointerup',
    event=>{

        if(
            stitchCameraIconDragV151
        ){

            stitchCameraFinishIconV151(
                event
            );


            return;
        }


        stitchCameraFinishWindowV151(
            event
        );
    },
    true
);


document.addEventListener(
    'pointercancel',
    event=>{

        if(
            stitchCameraIconDragV151
        ){

            stitchCameraFinishIconV151(
                event
            );


            return;
        }


        stitchCameraFinishWindowV151(
            event
        );
    },
    true
);


/* ================================================================
   RETIRE ORDINARY ICON CLICK BEHAVIOR

   D15 icons are window-state indicators / drag handles,
   not Show/Hide buttons.
   ================================================================ */

document.addEventListener(
    'click',
    event=>{

        const button =
            event.target.closest(
                '#view-live .stitch-camera-dock-btn[data-camera-mode]'
            );


        if(!button){
            return;
        }


        event.preventDefault();

        event.stopImmediatePropagation();
    },
    true
);


/* ================================================================
   INITIALIZE
   ================================================================ */

function stitchCameraInitializeD15V151(){

    if(
        document.body.classList.contains(
            'stitch-camera-d15-ready-v151'
        )
    ){
        return;
    }


    stitchCameraInitializeSlotsV151();


    stitchCameraApplyLayoutV151();


    document.body.classList.add(
        'stitch-camera-d15-ready-v151'
    );
}


stitchCameraInitializeD15V151();



/* STITCH_LOCAL_PREVIEW_QUIET_V147 */

if(
  stitchCameraUiPreviewV142()
){

  /*
   * Static UI preview has no Dragos API backend.
   */

  renderCameraModes();

  stitchCameraRefreshV147();

  updatePoseHud();

}
else{

  pollPose();

  poll();

  pollSystem();

  pollControllerProcess();

  pollCameraProcess();

  pollServiceControl();

  pollSlamStatus();

  bootstrapManagementKey();

  setInterval(poll,250);

  setInterval(updatePoseHud,250);

  setInterval(pollSystem,250);

  setInterval(pollControllerProcess,750);

  setInterval(pollCameraProcess,750);

  setInterval(pollSlamStatus,100);

  setInterval(pollServiceControl,2000);
}

})();



// FULL_DASH_STATUS_PALETTE_V1
function syncFullDashStatusPalette(){
  const root=document.documentElement;
  const good=$('controllerConfigureBtn');
  const warn=$('controllerStopBtn');

  if(!root||!good||!warn)return;

  const goodStyle=getComputedStyle(good);
  const warnStyle=getComputedStyle(warn);

  const copyTone=(prefix,style)=>{
    root.style.setProperty(
      `--${prefix}-fg`,
      style.color
    );
    root.style.setProperty(
      `--${prefix}-bg`,
      style.backgroundColor
    );
    root.style.setProperty(
      `--${prefix}-bg-image`,
      style.backgroundImage
    );
    root.style.setProperty(
      `--${prefix}-border`,
      style.borderTopColor
    );
    root.style.setProperty(
      `--${prefix}-shadow`,
      style.boxShadow
    );
  };

  copyTone(
    'full-status-good',
    goodStyle,
  );

  copyTone(
    'full-status-warn',
    warnStyle,
  );
}

if(document.readyState==='loading'){
  document.addEventListener(
    'DOMContentLoaded',
    ()=>{
      requestAnimationFrame(
        syncFullDashStatusPalette
      );
    },
    {once:true},
  );
}else{
  requestAnimationFrame(
    syncFullDashStatusPalette
  );
}
