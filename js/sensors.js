// js/sensors.js

const sensorData = CONFIG.SENSORS.map(cfg => ({
  ...cfg,
  vals: [],
  risk: 0,
  peak: 0,
}));

// Once true, the local per-frame JS simulation is permanently disabled.
// Backend polling exclusively drives the sensor values.
let _backendConnected = false;
let _latestSnapshot   = null;

// ── BACKEND POLLING ───────────────────────────────────────
// Called once from main.js init, then repeats every 7 seconds.
async function startBackendPolling() {
  console.log('[sensors] Starting backend polling...');
  await _fetchFromBackend();            // immediate first fetch
  setInterval(_fetchFromBackend, 7000); // then every 7 seconds
}

async function _fetchFromBackend() {
  try {
    const res = await fetch('/api/sensor-snapshot');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    if (json.status === 'ok' && json.data) {
      _latestSnapshot   = json.data;
      _backendConnected = true;   // ← disables JS simulation permanently

      // Push each sensor's value into its rolling history
      sensorData.forEach(s => {
        const reading = json.data[s.id];
        if (reading !== undefined) {
          _pushValue(s, reading.value);
          s.risk = reading.risk;
          s.peak = Math.max(...s.vals.map(Math.abs));
        }
      });

      // Update header status indicator
      const isLive = json.data.source === 'live';
      const dot    = document.getElementById('status-dot');
      const txt    = document.getElementById('status-text');
      if (dot && txt) {
        dot.style.background = isLive ? 'var(--safe)' : 'var(--accent)';
        dot.style.boxShadow  = isLive
          ? '0 0 6px var(--safe)' : '0 0 6px var(--accent)';
        txt.textContent = isLive
          ? 'LIVE — CONSENTIUM IoT' : 'LIVE — SIMULATED DATA';
      }

      console.log(`[sensors] Poll received. Source: ${json.data.source} | `
        + `S1=${json.data.S1.value.toFixed(4)} `
        + `S2=${json.data.S2.value.toFixed(4)} `
        + `S3=${json.data.S3.value.toFixed(4)}`);
    }
  } catch (err) {
    // Backend unreachable — local JS simulation keeps running as fallback
    console.warn('[sensors] Backend poll failed:', err.message);
  }
}

// ── LOCAL SIMULATION FALLBACK ─────────────────────────────
// Runs ONLY when _backendConnected is false (i.e. backend never responded).
// Called every animation frame from main.js.
function updateSensorsSimulated(timestamp, mode, amplitude, crackRisk) {
  if (_backendConnected) return;  // backend is live — do absolutely nothing
  if (mode < 1 || mode > CONFIG.MODE_FREQS.length) return;

  const freq = CONFIG.MODE_FREQS[mode - 1];
  sensorData.forEach(s => {
    const normX = (s.pos + 1) / 2;
    const shape = getModeShape(normX, mode);
    const noise = (Math.random() - 0.5) * 0.015;
    const scale = s.type === 'accelerometer' ? 0.08 : 0.05;
    const val   = shape * amplitude * scale
                * Math.sin(2 * Math.PI * freq * timestamp * 0.001)
                + noise;
    _pushValue(s, val);
    s.risk = Math.min(100, Math.abs(shape) * crackRisk * 1.2);
    s.peak = Math.max(...s.vals.map(Math.abs));
  });
}

// ── HELPERS ───────────────────────────────────────────────
function _pushValue(sensor, val) {
  sensor.vals.push(val);
  if (sensor.vals.length > CONFIG.HISTORY_LENGTH) sensor.vals.shift();
}

function resetSensorData() {
  sensorData.forEach(s => { s.vals = []; s.risk = 0; s.peak = 0; });
  _backendConnected = false;
  _latestSnapshot   = null;
}

function getSensorFeatures() {
  return sensorData.map(s => {
    const vals = s.vals;
    if (!vals.length) return { id: s.id, mean: 0, rms: 0, peak: 0, risk: s.risk };
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const rms  = Math.sqrt(vals.reduce((a, b) => a + b * b, 0) / vals.length);
    return { id: s.id, mean, rms, peak: s.peak, risk: s.risk };
  });
}