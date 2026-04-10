// js/ui.js

const modeFreqs = CONFIG.MODE_FREQS;
const startTime = Date.now();

// ── BUILD STRIP CARDS (called once at init) ───────────────
// ── BUILD STRIP CARDS (called once at init) ───────────────
function buildSensorCards() {
  sensorData.forEach(s => {
    const slot = document.getElementById(`strip-${s.id}`);
    if (!slot) {
      console.warn(`[ui] strip slot not found: strip-${s.id}`);
      return;
    }

    // ── CUSTOM LOGIC FOR S3 (Ultrasonic) ──────────────────
    let typeLabel = s.type === 'accelerometer' ? '⟳ Accel' : '⊕ Strain';
    let unit      = s.type === 'accelerometer' ? 'g' : 'mv';

    if (s.id === 'S3') {
      typeLabel = '📡 Dist'; // Ultrasonic label
      unit      = 'cm';      // Your requested unit
    }
    // ──────────────────────────────────────────────────────

    slot.innerHTML = `
      <div class="strip-header">
        <span class="strip-id">${s.id}</span>
        <span class="strip-type-badge">${typeLabel}</span>
        <span class="strip-status s-normal" id="sts-${s.id}">Normal</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:4px;margin:2px 0;">
        <span class="strip-value" id="val-${s.id}">0.000</span>
        <span class="strip-unit">${unit}</span>
        <span class="strip-label" style="margin-left:6px;">${s.label}</span>
      </div>
      <canvas class="strip-sparkline" id="spark-${s.id}" height="24"></canvas>
      <div class="strip-risk-row">
        <span class="strip-risk-label">Crack risk</span>
        <div class="strip-risk-bar-bg">
          <div class="strip-risk-bar-fill"
               id="rb-${s.id}"
               style="width:0%;background:var(--safe)"></div>
        </div>
        <span class="strip-risk-pct" id="rp-${s.id}">0%</span>
      </div>`;
  });

  console.log('[ui] Sensor strip cards built.');
}

// ── MAIN UI UPDATE (animation loop, throttled) ────────────
// Handles HUD, uptime, FFT, and alert box.
// Sensor strip values are updated directly in sensors.js
// via _updateStripDOM() on each backend poll.
function updateUI(maxDefl, mode, crackRisk) {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  document.getElementById('uptime').textContent = `t = ${elapsed}s`;

  const validMode = mode >= 1 && mode <= modeFreqs.length;
  const freq      = validMode ? modeFreqs[mode - 1] : 0;

  document.getElementById('nat-freq').textContent =
    validMode ? `fn = ${freq.toFixed(1)} Hz` : 'fn = — Hz';

  document.getElementById('hud-defl').innerHTML =
    `${maxDefl.toFixed(2)} <span class="hud-unit">mm</span>`;

  // Alert box
  const anyAlert = sensorData.some(s => s.risk > CONFIG.RISK.CRITICAL);
  const alertBox  = document.getElementById('alert-box');
  if (alertBox) {
    alertBox.classList.toggle('visible', anyAlert);
    if (anyAlert) {
      const crit = sensorData
        .filter(s => s.risk > CONFIG.RISK.CRITICAL)
        .map(s => s.id).join(', ');
      const msgEl = document.getElementById('alert-msg');
      if (msgEl) msgEl.textContent = `High stress at ${crit}. Inspect immediately.`;
    }
  }

  // FFT — only draw if canvas exists (user may have removed it)
  const fftCanvas = document.getElementById('fft-canvas');
  if (fftCanvas) drawFFT(mode, crackRisk);
}

// ── SPARKLINE ─────────────────────────────────────────────
function drawSparkline(s) {
  const canvas = document.getElementById(`spark-${s.id}`);
  if (!canvas || s.vals.length < 2) return;

  canvas.width  = canvas.offsetWidth * devicePixelRatio;
  canvas.height = 24 * devicePixelRatio;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const w = canvas.width, h = canvas.height, mid = h / 2;
  const max = Math.max(...s.vals.map(Math.abs), 0.001);
  const rr  = s.risk / 100;

  ctx.strokeStyle = '#1a2535';
  ctx.lineWidth   = 0.5;
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();

  const R = Math.round((0.1 + rr * 0.9) * 255);
  const G = Math.round((0.8 - rr * 0.6) * 255);
  const B = Math.round((1.0 - rr * 0.8) * 255);
  ctx.strokeStyle = `rgb(${R},${G},${B})`;
  ctx.lineWidth   = 1.5 * devicePixelRatio;
  ctx.beginPath();
  s.vals.forEach((v, i) => {
    const x = (i / (s.vals.length - 1)) * w;
    const y = mid - (v / max) * mid * 0.78;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ── FFT ───────────────────────────────────────────────────
function drawFFT(mode, crackRisk) {
  const canvas = document.getElementById('fft-canvas');
  if (!canvas) return;

  canvas.width  = canvas.offsetWidth * devicePixelRatio;
  canvas.height = 56 * devicePixelRatio;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const w = canvas.width, h = canvas.height;
  const rr         = crackRisk / 100;
  const validMode  = mode >= 1 && mode <= modeFreqs.length;
  const activePeak = validMode ? modeFreqs[mode - 1] : -1;
  const freqBins   = [8, 12.4, 20, 31.2, 42, 58.7, 75, 90];
  const slotW      = w / freqBins.length;

  freqBins.forEach((f, i) => {
    const isActive = activePeak > 0 && Math.abs(f - activePeak) < 2;
    const mag      = isActive
      ? 0.85 + Math.random() * 0.10 + rr * 0.10
      : 0.05 + Math.random() * 0.07;

    const bh = mag * h * 0.9;
    const bw = slotW * 0.6;
    const x  = i * slotW + slotW * 0.2;

    ctx.fillStyle = isActive
      ? `rgb(${Math.round((0.1+rr*0.9)*255)},${Math.round((0.83-rr*0.5)*255)},255)`
      : 'rgb(30,80,120)';
    ctx.fillRect(x, h - bh, bw, bh);
  });

  const peakEl = document.getElementById('fft-peak');
  if (peakEl) peakEl.textContent = activePeak > 0 ? `${activePeak} Hz` : '—';
}

// ── STATUS HELPERS ────────────────────────────────────────
function setStatusText(t) {
  const el = document.getElementById('status-text');
  if (el) el.textContent = t;
}
function setLoadMsg(t) {
  const el = document.getElementById('load-msg');
  if (el) el.textContent = t;
}
function showErrorScreen(detail) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('error-screen').classList.add('visible');
  const d = document.getElementById('err-detail');
  if (d && detail) d.textContent = detail;
}
function hideLoadingScreen() {
  document.getElementById('loading').style.display = 'none';
}