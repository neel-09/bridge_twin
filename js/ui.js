// ui.js
// All DOM updates: sensor cards, sparklines, FFT, HUD, alerts.
// Reads CONFIG for thresholds — no magic numbers.

const startTime = Date.now();

// ── BUILD SENSOR CARDS (called once on init) ─────────────
function buildSensorCards() {
  const container = document.getElementById('sensor-cards');
  container.innerHTML = '';

  sensorData.forEach(s => {
    const typeLabel = s.type === 'accelerometer' ? '⟳ Accel' : '⊕ Strain';
    container.innerHTML += `
      <div class="sensor-card" id="card-${s.id}">
        <div class="sensor-card-header">
          <span class="sensor-id">${s.id}</span>
          <span class="sensor-type">${typeLabel}</span>
          <span class="sensor-status s-normal" id="sts-${s.id}">Normal</span>
        </div>
        <div class="sensor-val" id="val-${s.id}">0.000</div>
        <div class="sensor-sub">${s.label}</div>
        <canvas class="sparkline" id="spark-${s.id}" height="28"></canvas>
        <div class="risk-wrap">
          <div class="risk-label">
            <span>Crack risk</span>
            <span id="rp-${s.id}">0%</span>
          </div>
          <div class="risk-bar-bg">
            <div class="risk-bar-fill" id="rb-${s.id}"
                 style="width:0%;background:var(--safe)"></div>
          </div>
        </div>
      </div>`;
  });
}

// ── MAIN UI UPDATE (called every UI_UPDATE_EVERY frames) ──
function updateUI(maxDefl, mode, crackRisk) {
  

  // Guard: mode may be out of range briefly during reset
  const validMode = mode >= 1 && mode <= CONFIG.MODE_FREQS.length;
  const freq = validMode ? CONFIG.MODE_FREQS[mode - 1] : 0;

  document.getElementById('nat-freq').textContent = `fn = ${freq.toFixed(1)} Hz`;
  document.getElementById('hud-defl').innerHTML =
    `${maxDefl.toFixed(2)} <span class="hud-unit">mm</span>`;

  let anyAlert = false;

  sensorData.forEach(s => {
    const last = s.vals[s.vals.length - 1] || 0;
    // Show correct engineering unit per sensor type
    const unit = s.type === 'accelerometer' ? 'm/s²' : '%';
    document.getElementById(`val-${s.id}`).textContent =
      `${Math.abs(last).toFixed(3)} ${unit}`;

    const rp   = Math.round(s.risk);
    const fill = document.getElementById(`rb-${s.id}`);
    const sts  = document.getElementById(`sts-${s.id}`);
    const card = document.getElementById(`card-${s.id}`);

    document.getElementById(`rp-${s.id}`).textContent = `${rp}%`;
    fill.style.width = rp + '%';
    fill.style.background =
      rp > CONFIG.RISK.CRITICAL ? 'var(--danger)' :
      rp > CONFIG.RISK.WARNING  ? 'var(--warn)'   : 'var(--safe)';

    if (rp > CONFIG.RISK.CRITICAL) {
      sts.textContent = 'Critical'; sts.className = 'sensor-status s-danger';
      card.className  = 'sensor-card danger'; anyAlert = true;
    } else if (rp > CONFIG.RISK.WARNING) {
      sts.textContent = 'Warning'; sts.className = 'sensor-status s-warn';
      card.className  = 'sensor-card warn';
    } else {
      sts.textContent = 'Normal'; sts.className = 'sensor-status s-normal';
      card.className  = 'sensor-card';
    }

    drawSparkline(s);
  });

  // ── ALERT BOX ──────────────────────────────────────────
  document.getElementById('alert-box').classList.toggle('visible', anyAlert);
  if (anyAlert) {
    const crit = sensorData
      .filter(s => s.risk > CONFIG.RISK.CRITICAL)
      .map(s => s.id).join(', ');
    document.getElementById('alert-msg').textContent =
      `High stress at ${crit}. Inspect immediately.`;
  }

  drawFFT(mode, crackRisk);
}

// ── SPARKLINE ─────────────────────────────────────────────
function drawSparkline(s) {
  const canvas = document.getElementById(`spark-${s.id}`);
  if (!canvas || s.vals.length < 2) return;

  canvas.width  = canvas.offsetWidth * devicePixelRatio;
  canvas.height = 28 * devicePixelRatio;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const w = canvas.width, h = canvas.height, mid = h / 2;
  const max = Math.max(...s.vals.map(Math.abs), 0.001);
  const rr  = s.risk / 100;

  // Zero line
  ctx.strokeStyle = '#1e2a3a';
  ctx.lineWidth   = 0.5;
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();

  // Signal — colour shifts green → red with crack risk
  const R = Math.round((0.1 + rr * 0.9) * 255);
  const G = Math.round((0.8 - rr * 0.6) * 255);
  const B = Math.round((1.0 - rr * 0.8) * 255);
  ctx.strokeStyle = `rgb(${R},${G},${B})`;
  ctx.lineWidth   = 1.5 * devicePixelRatio;
  ctx.beginPath();
  s.vals.forEach((v, i) => {
    const x = (i / (s.vals.length - 1)) * w;
    const y = mid - (v / max) * mid * 0.8;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ── FFT BAR CHART ─────────────────────────────────────────
function drawFFT(mode, crackRisk) {
  const canvas = document.getElementById('fft-canvas');
  canvas.width  = canvas.offsetWidth * devicePixelRatio;
  canvas.height = 60 * devicePixelRatio;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const w = canvas.width, h = canvas.height;
  const rr = crackRisk / 100;
  const validMode  = mode >= 1 && mode <= CONFIG.MODE_FREQS.length;
  const activePeak = validMode ? CONFIG.MODE_FREQS[mode - 1] : -1;

  const freqBins = [8, 12.4, 20, 31.2, 42, 58.7, 75, 90];
  const slotW    = w / freqBins.length;

  freqBins.forEach((f, i) => {
    const isActive = activePeak > 0 && Math.abs(f - activePeak) < 2;
    const mag      = isActive
      ? 0.85 + Math.random() * 0.10 + rr * 0.10
      : 0.05 + Math.random() * 0.07;

    const bh = mag * h * 0.9;
    const bw = slotW * 0.6;
    const x  = i * slotW + slotW * 0.2;

    ctx.fillStyle = isActive
      ? `rgb(${Math.round((0.1 + rr * 0.9) * 255)},${Math.round((0.83 - rr * 0.5) * 255)},255)`
      : 'rgb(40,100,150)';
    ctx.fillRect(x, h - bh, bw, bh);
  });

  document.getElementById('fft-peak').textContent =
    activePeak > 0 ? `${activePeak} Hz` : '—';
}

// ── STATUS HELPERS ────────────────────────────────────────
function setStatusText(t) { document.getElementById('status-text').textContent = t; }
function setLoadMsg(t)    { document.getElementById('load-msg').textContent     = t; }

function showErrorScreen(detail) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('error-screen').classList.add('visible');
  if (detail) document.getElementById('err-detail').textContent = detail;
}

function hideLoadingScreen() {
  document.getElementById('loading').style.display = 'none';
}