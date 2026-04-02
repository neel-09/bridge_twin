// sensors.js
// Sensor state, simulated data generation, and live data injection.
// ─────────────────────────────────────────────────────────────────
// HOW TO SWITCH TO REAL IoT DATA (Consentium / WebSocket):
//   1. Open a WebSocket connection anywhere (e.g. a new dataSource.js).
//   2. On each message call:
//        injectLiveSensorData({ S1: <val>, S2: <val>, S3: <val> })
//   3. Nothing else in the codebase needs editing.

// Initialise from CONFIG — adding/removing a sensor only requires
// editing CONFIG.SENSORS, not this file.
const sensorData = CONFIG.SENSORS.map(cfg => ({
  ...cfg,
  vals: [],   // rolling history of amplitude readings
  risk: 0,    // computed crack-risk percentage (0–100)
  peak: 0,    // maximum absolute reading seen this session
}));

let usingLiveData = false;

// ── SIMULATED UPDATE ──────────────────────────────────────
// Called every animation frame when no real sensor is connected.
function updateSensorsSimulated(timestamp, mode, amplitude, crackRisk) {
  if (usingLiveData) return;
  if (mode < 1 || mode > CONFIG.MODE_FREQS.length) return;

  const freq = CONFIG.MODE_FREQS[mode - 1];

  sensorData.forEach(s => {
    const normX = (s.pos + 1) / 2;                         // -1…+1  →  0…1
    const shape = getModeShape(normX, mode);
    const noise = (Math.random() - 0.5) * 0.015;

    // Strain gauges measure relative deformation; accelerometer measures g.
    const scaleFactor = s.type === 'accelerometer' ? 0.08 : 0.05;
    const val = shape * amplitude * scaleFactor
              * Math.sin(2 * Math.PI * freq * timestamp * 0.001)
              + noise;

    _pushValue(s, val);
    s.risk = Math.min(100, Math.abs(shape) * crackRisk * 1.2);
    s.peak = Math.max(...s.vals.map(Math.abs));
  });
}

// ── LIVE DATA INJECTION ───────────────────────────────────
// packet format: { S1: <number>, S2: <number>, S3: <number> }
// Units: S1/S3 → microstrain (με); S2 → g
function injectLiveSensorData(packet) {
  usingLiveData = true;
  sensorData.forEach(s => {
    if (packet[s.id] !== undefined) _pushValue(s, packet[s.id]);
  });
}

// ── HELPERS ───────────────────────────────────────────────
function _pushValue(sensor, val) {
  sensor.vals.push(val);
  if (sensor.vals.length > CONFIG.HISTORY_LENGTH) sensor.vals.shift();
}

function resetSensorData() {
  sensorData.forEach(s => { s.vals = []; s.risk = 0; s.peak = 0; });
  usingLiveData = false;
}

// ── FEATURE EXPORT (for future ML pipeline) ───────────────
// Returns a flat feature vector per sensor: [mean, rms, peak, risk]
// Feed this into your predictive maintenance model.
function getSensorFeatures() {
  return sensorData.map(s => {
    const vals = s.vals;
    if (!vals.length) return { id: s.id, mean: 0, rms: 0, peak: 0, risk: s.risk };
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const rms  = Math.sqrt(vals.reduce((a, b) => a + b * b, 0) / vals.length);
    return { id: s.id, mean, rms, peak: s.peak, risk: s.risk };
  });
}