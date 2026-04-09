// js/sensors.js

const sensorData = CONFIG.SENSORS.map(cfg => ({
  ...cfg,
  vals: [],
  risk: 0,
  peak: 0,
}));

let _latestSnapshot = null;

// ── BACKEND POLLING ───────────────────────────────────────
async function startBackendPolling() {
  console.log('[sensors] Starting live Consentium polling...');
  await _fetchFromBackend();
  setInterval(_fetchFromBackend, 7000);
}

async function _fetchFromBackend() {
  try {
    const res = await fetch('/api/sensor-snapshot');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    if (json.status === 'ok' && json.data) {
      _latestSnapshot = json.data;

      sensorData.forEach(s => {
        const reading = json.data[s.id];
        if (reading !== undefined) {
          _pushValue(s, reading.value);
          s.risk = reading.risk;
          s.peak = Math.max(...s.vals.map(Math.abs));
        }
      });

      _updateStripDOM(json.data);

      // Header dot always shows live (green)
      const dot = document.getElementById('status-dot');
      const txt = document.getElementById('status-text');
      if (dot && txt) {
        dot.style.background = 'var(--safe)';
        dot.style.boxShadow  = '0 0 6px var(--safe)';
        txt.textContent      = 'LIVE — CONSENTIUM IoT';
      }

      console.log(
        `[sensors] Live data | `
        + `S2=${json.data.S2.value.toFixed(4)}g | `
        + `risk=${json.data.S2.risk.toFixed(1)}% | `
        + json.data.overall_status
      );
    }
  } catch (err) {
    console.error('[sensors] Fetch failed:', err.message);

    // Show connection error in status bar
    const txt = document.getElementById('status-text');
    if (txt) txt.textContent = 'CONNECTION ERROR — retrying…';
  }
}

// ── DIRECT STRIP PANEL UPDATE ─────────────────────────────
function _updateStripDOM(data) {
  sensorData.forEach(s => {
    const reading = data[s.id];
    if (!reading) return;

    const rp = Math.round(reading.risk);

    const valEl = document.getElementById(`val-${s.id}`);
    if (valEl) valEl.textContent = Math.abs(reading.value).toFixed(3);

    const fill = document.getElementById(`rb-${s.id}`);
    if (fill) {
      fill.style.width      = rp + '%';
      fill.style.background =
        rp > CONFIG.RISK.CRITICAL ? 'var(--danger)' :
        rp > CONFIG.RISK.WARNING  ? 'var(--warn)'   : 'var(--safe)';
    }

    const rpEl = document.getElementById(`rp-${s.id}`);
    if (rpEl) rpEl.textContent = `${rp}%`;

    const sts  = document.getElementById(`sts-${s.id}`);
    const slot = document.getElementById(`strip-${s.id}`);
    if (sts) {
      if (rp > CONFIG.RISK.CRITICAL) {
        sts.textContent = 'Critical';
        sts.className   = 'strip-status s-danger';
        if (slot) slot.style.background = 'rgba(255,61,61,0.05)';
      } else if (rp > CONFIG.RISK.WARNING) {
        sts.textContent = 'Warning';
        sts.className   = 'strip-status s-warn';
        if (slot) slot.style.background = 'rgba(255,179,0,0.05)';
      } else {
        sts.textContent = 'Normal';
        sts.className   = 'strip-status s-normal';
        if (slot) slot.style.background = '';
      }
    }

    drawSparkline(s);
  });
}

// ── NO SIMULATION ─────────────────────────────────────────
// This function is called from main.js animation loop.
// It is intentionally empty — all data comes from Consentium.
function updateSensorsSimulated(timestamp, mode, amplitude, crackRisk) {
  // Live mode: do nothing. Consentium polling drives everything.
}

// ── HELPERS ───────────────────────────────────────────────
function _pushValue(sensor, val) {
  sensor.vals.push(val);
  if (sensor.vals.length > CONFIG.HISTORY_LENGTH) sensor.vals.shift();
}

function resetSensorData() {
  sensorData.forEach(s => { s.vals = []; s.risk = 0; s.peak = 0; });
  _latestSnapshot = null;
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