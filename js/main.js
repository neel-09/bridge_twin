// main.js
// Entry point — sets up the Three.js scene, lights, renderer,
// orbit controls, and runs the animation loop.
// Also owns the simulation state (currentMode, amplitude, crackRisk).

// ── SIMULATION STATE ──────────────────────────────────────
let currentMode = 1.0;
let amplitude   = 1.0;
let crackRisk   = 0;
let frameCount  = 0;

// ── RENDERER ──────────────────────────────────────────────
const wrap     = document.getElementById('canvas-wrap');
const renderer = new THREE.WebGLRenderer({
  canvas:    document.getElementById('three-canvas'),
  antialias: true,
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x070a0f, 1);
renderer.shadowMap.enabled = true;

// ── SCENE ─────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.fog   = new THREE.FogExp2(0x070a0f, 0.05);

// ── CAMERA ────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(45, 1, 0.001, 200);
camera.position.set(0, 0.5, 1.2);

// ── ORBIT CONTROLS ────────────────────────────────────────
const controls          = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping  = true;
controls.dampingFactor  = 0.08;
controls.minDistance    = 0.2;
controls.maxDistance    = 10;
controls.target.set(0, 0, 0);

// ── LIGHTING ──────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x223344, 2.5));

const dirLight = new THREE.DirectionalLight(0x00d4ff, 1.5);
dirLight.position.set(3, 5, 3);
dirLight.castShadow = true;
scene.add(dirLight);

const rimLight = new THREE.DirectionalLight(0x334466, 1.0);
rimLight.position.set(-3, 2, -3);
scene.add(rimLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
fillLight.position.set(0, -2, 0);
scene.add(fillLight);

// ── GRID ──────────────────────────────────────────────────
const grid = new THREE.GridHelper(10, 30, 0x1e2a3a, 0x111820);
scene.add(grid);

// ── ANIMATION LOOP ────────────────────────────────────────
function animate(timestamp) {
  requestAnimationFrame(animate);
  controls.update();

  const maxDefl = updateDeformation(timestamp, currentMode, amplitude, crackRisk, modeFreqs);
  updateSensorsSimulated(timestamp, currentMode, amplitude, crackRisk, modeFreqs);

  // Update UI every 6 frames (~10fps) to avoid DOM thrashing
  if (++frameCount % 6 === 0) {
    updateUI(maxDefl, currentMode, crackRisk);
  }

  renderer.render(scene, camera);
}

// ── RESIZE HANDLER ────────────────────────────────────────
function onResize() {
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

// ── CONTROL BINDINGS ──────────────────────────────────────
document.getElementById('amp-slider').addEventListener('input', function() {
  amplitude = parseFloat(this.value);
  document.getElementById('amp-val').textContent = amplitude.toFixed(1) + '×';
});

document.getElementById('risk-slider').addEventListener('input', function() {
  crackRisk = parseInt(this.value);
  document.getElementById('risk-val').textContent = crackRisk + '%';
});

// Called by Mode 1 / Mode 2 / Mode 3 buttons in index.html
function setMode(m) {
  currentMode = m;
  [1, 2, 3].forEach(i => {
    document.getElementById(`btn-mode${i}`).classList.toggle('active', i === m);
  });
}

// Gradually ramps up crack risk to simulate a failure scenario
function simulateCrack() {
  let v = crackRisk;
  const iv = setInterval(() => {
    v = Math.min(85, v + 2);
    document.getElementById('risk-slider').value = v;
    crackRisk = v;
    document.getElementById('risk-val').textContent = v + '%';
    if (v >= 85) clearInterval(iv);
  }, 40);

  amplitude = Math.min(10, amplitude + 2);
  document.getElementById('amp-slider').value = amplitude;
  document.getElementById('amp-val').textContent = amplitude.toFixed(1) + '×';
}

// Resets everything back to default state
function resetSim() {
  crackRisk   = 0;
  amplitude   = 0.0; // Changed from 1.0
  currentMode = 0;   // Changed from 1 (0 means no mode active)

  document.getElementById('risk-slider').value     = 0;
  document.getElementById('risk-val').textContent  = '0%';
  document.getElementById('amp-slider').value      = 0;    // Changed from 1
  document.getElementById('amp-val').textContent   = '0.0×'; // Changed from 1.0x

  setMode(0); // Deselects all mode buttons
  resetDeformation();
  resetSensorData();
  document.getElementById('alert-box').classList.remove('visible');
}

// ── INIT ──────────────────────────────────────────────────
buildSensorCards();
loadBridgeModel(scene, camera, controls);
animate(0);
