// ui.js
// Handles all DOM updates: sensor cards, sparklines, FFT chart, HUD, alerts.
// No Three.js in here — purely HTML/Canvas UI.

const modeFreqs = [12, 31.2, 58.7];  // Hz for modes 1, 2, 3
const startTime = Date.now();

// ── BUILD SENSOR CARDS (called once on init) ──────────────
function buildSensorCards() {
  const container = document.getElementById('sensor-cards');
  container.innerHTML = '';
  sensorData.forEach(s => {
    container.innerHTML += `
      <div class="sensor-card" id="card-${s.id}">
        <div class="sensor-card-header">
          <span class="sensor-id">${s.id}</span>
          <span class="sensor-status s-normal" id="sts-${s.id}">Normal</span>
        </div>
        <div class="sensor-val" id="val-${s.id}">0.000 g</div>
        <div class="sensor-sub">${s.label}</div>
        <canvas class="sparkline" id="spark-${s.id}" height="28"></canvas>
        <div class="risk-wrap">
          <div class="risk-label">
            <span>Crack risk</span>
            <span id="rp-${s.id}">0%</span>
          </div>
          <div class="risk-bar-bg">
            <div class="risk-bar-fill" id="rb-${s.id}" style="width:0%;background:var(--safe)"></div>
          </div>
        </div>
      </div>`;
  });
}

// ── UPDATE ALL UI (called every ~6 frames) ────────────────
function updateUI(maxDefl, currentMode, crackRisk) {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  document.getElementById('uptime').textContent    = `t = ${elapsed}s`;
  const freq = currentMode > 0 ? modeFreqs[currentMode - 1] : 0;
  document.getElementById('nat-freq').textContent  = `fn = ${freq} Hz`;
  document.getElementById('hud-defl').innerHTML    = `${maxDefl.toFixed(2)} <span class="hud-unit">mm</span>`;

  let anyAlert = false;

  sensorData.forEach(s => {
    const last = s.vals[s.vals.length - 1] || 0;
    document.getElementById(`val-${s.id}`).textContent = `${Math.abs(last).toFixed(3)} g`;

    const rp   = Math.round(s.risk);
    const fill = document.getElementById(`rb-${s.id}`);
    const sts  = document.getElementById(`sts-${s.id}`);
    const card = document.getElementById(`card-${s.id}`);

    document.getElementById(`rp-${s.id}`).textContent = `${rp}%`;
    fill.style.width      = rp + '%';
    fill.style.background = rp > 70 ? 'var(--danger)' : rp > 35 ? 'var(--warn)' : 'var(--safe)';

    if (rp > 70) {
      sts.textContent  = 'Critical';
      sts.className    = 'sensor-status s-danger';
      card.className   = 'sensor-card danger';
      anyAlert         = true;
    } else if (rp > 35) {
      sts.textContent  = 'Warning';
      sts.className    = 'sensor-status s-warn';
      card.className   = 'sensor-card warn';
    } else {
      sts.textContent  = 'Normal';
      sts.className    = 'sensor-status s-normal';
      card.className   = 'sensor-card';
    }

    drawSparkline(s);
  });

  document.getElementById('alert-box').classList.toggle('visible', anyAlert);
  drawFFT(currentMode, crackRisk);
}

// ── SPARKLINE CANVAS ──────────────────────────────────────
function drawSparkline(s) {
  const canvas = document.getElementById(`spark-${s.id}`);
  if (!canvas || s.vals.length < 2) return;

  canvas.width  = canvas.offsetWidth * devicePixelRatio;
  canvas.height = 28 * devicePixelRatio;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const w   = canvas.width;
  const h   = canvas.height;
  const mid = h / 2;
  const max = Math.max(...s.vals.map(Math.abs), 0.001);
  const rr  = s.risk / 100;

  // Zero line
  ctx.strokeStyle = '#1e2a3a';
  ctx.lineWidth   = 0.5;
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();

  // Signal line — color shifts green → red with crack risk
  const r = Math.round((0.1 + rr * 0.9) * 255);
  const g = Math.round((0.8 - rr * 0.6) * 255);
  const b = Math.round((1.0 - rr * 0.8) * 255);
  ctx.strokeStyle = `rgb(${r},${g},${b})`;
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
function drawFFT(currentMode, crackRisk) {
  const canvas = document.getElementById('fft-canvas');
  canvas.width  = canvas.offsetWidth * devicePixelRatio;
  canvas.height = 60 * devicePixelRatio;

  const ctx  = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const w    = canvas.width;
  const h    = canvas.height;
  const rr   = crackRisk / 100;

  // Representative frequency bins
  const freqs = [8, 12.4, 20, 31.2, 42, 58.7, 75, 90];

  freqs.forEach((f, i) => {
    const isActive = Math.abs(f - modeFreqs[currentMode - 1]) < 2;
    const mag      = isActive
      ? 0.85 + Math.random() * 0.1 + rr * 0.1
      : 0.05 + Math.random() * 0.07;

    const bh  = mag * h * 0.9;
    const bw  = (w / freqs.length) * 0.6;
    const x   = i * (w / freqs.length) + (w / freqs.length) * 0.2;

    ctx.fillStyle = isActive
      ? `rgb(${Math.round((0.1 + rr * 0.9) * 255)},${Math.round((0.83 - rr * 0.5) * 255)},255)`
      : 'rgb(40,100,150)';

    ctx.fillRect(x, h - bh, bw, bh);
  });

  document.getElementById('fft-peak').textContent = `${modeFreqs[currentMode - 1]} Hz`;
}

// ── STATUS BAR TEXT ───────────────────────────────────────
function setStatusText(text) {
  document.getElementById('status-text').textContent = text;
}
function setLoadMsg(text) {
  document.getElementById('load-msg').textContent = text;
}
function showErrorScreen(detail) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('error-screen').classList.add('visible');
  if (detail) document.getElementById('err-detail').textContent = detail;
}
function hideLoadingScreen() {
  document.getElementById('loading').style.display = 'none';
}
