// js/main.js

let currentMode = CONFIG.DEFAULT_MODE;
let amplitude   = CONFIG.DEFAULT_AMPLITUDE;
let crackRisk   = 0;
let frameCount  = 0;

// ── RENDERER ──────────────────────────────────────────────
const wrap     = document.getElementById('canvas-wrap');
const renderer = new THREE.WebGLRenderer({
  canvas:    document.getElementById('three-canvas'),
  antialias: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

// ── SCENE ─────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.fog   = new THREE.FogExp2(0x000000, 0.04);

// ── CAMERA — fixed, no orbit ──────────────────────────────
const camera = new THREE.PerspectiveCamera(42, 1, 0.001, 200);
// Position set here as default; loader.js overrides after model loads
camera.position.set(0, 0.6, 1.6);
camera.lookAt(0, 0.1, 0);

// ── NO ORBIT CONTROLS — bridge is fully static ────────────
// OrbitControls script is still loaded (required by loader.js import chain)
// but we do not create a controls instance.

// ── LIGHTING ──────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x223344, 2.8));

const dirLight = new THREE.DirectionalLight(0x00d4ff, 1.6);
dirLight.position.set(3, 5, 3);
dirLight.castShadow            = true;
dirLight.shadow.mapSize.width  = 1024;
dirLight.shadow.mapSize.height = 1024;
scene.add(dirLight);

const rimLight = new THREE.DirectionalLight(0x334466, 1.0);
rimLight.position.set(-3, 2, -3);
scene.add(rimLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
fillLight.position.set(0, -2, 0);
scene.add(fillLight);

// ── GRID ──────────────────────────────────────────────────
scene.add(new THREE.GridHelper(10, 30, 0x1a2535, 0x0d1420));

// ── ANIMATION LOOP ────────────────────────────────────────
function animate(timestamp) {
  requestAnimationFrame(animate);
  // No controls.update() — camera is fixed

  const maxDefl = updateDeformation(
    timestamp, currentMode, amplitude, crackRisk
  );
  updateSensorsSimulated(timestamp, currentMode, amplitude, crackRisk);

  if (++frameCount % CONFIG.UI_UPDATE_EVERY === 0) {
    updateUI(maxDefl, currentMode, crackRisk);
  }

  renderer.render(scene, camera);
}

// ── RESIZE ────────────────────────────────────────────────
function onResize() {
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

// ── SLIDER CONTROLS ───────────────────────────────────────
document.getElementById('amp-slider').addEventListener('input', function () {
  amplitude = parseFloat(this.value);
  document.getElementById('amp-val').textContent = amplitude.toFixed(1) + '×';
});
document.getElementById('risk-slider').addEventListener('input', function () {
  crackRisk = parseInt(this.value, 10);
  document.getElementById('risk-val').textContent = crackRisk + '%';
});

// ── MODE BUTTONS ──────────────────────────────────────────
function setMode(m) {
  currentMode = m;
  [1, 2, 3].forEach(i =>
    document.getElementById(`btn-mode${i}`)
            .classList.toggle('active', i === m)
  );
}

function simulateCrack() {
  let v = crackRisk;
  const iv = setInterval(() => {
    v = Math.min(85, v + 2);
    crackRisk = v;
    document.getElementById('risk-slider').value    = v;
    document.getElementById('risk-val').textContent = v + '%';
    if (v >= 85) clearInterval(iv);
  }, 40);
  amplitude = Math.min(10, amplitude + 2);
  document.getElementById('amp-slider').value    = amplitude;
  document.getElementById('amp-val').textContent = amplitude.toFixed(1) + '×';
}

function resetSim() {
  crackRisk   = 0;
  amplitude   = CONFIG.DEFAULT_AMPLITUDE;
  currentMode = CONFIG.DEFAULT_MODE;
  document.getElementById('risk-slider').value    = 0;
  document.getElementById('risk-val').textContent = '0%';
  document.getElementById('amp-slider').value     = amplitude;
  document.getElementById('amp-val').textContent  = amplitude.toFixed(1) + '×';
  setMode(CONFIG.DEFAULT_MODE);
  resetDeformation();
  resetSensorData();
  document.getElementById('alert-box').classList.remove('visible');
}

// ── DETAIL PAGE ───────────────────────────────────────────
function openDetailPage() {
  const a = document.createElement('a');
  a.href   = '/detail';
  a.target = '_blank';
  a.rel    = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── INIT ──────────────────────────────────────────────────
buildSensorCards();
loadBridgeModel(scene, camera, null);   // null = no controls
startBackendPolling();
animate(0);