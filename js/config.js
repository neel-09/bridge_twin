// config.js
// Single source of truth for every constant used across the project.
// When integrating real IoT data (Consentium / WebSocket), only edit
// this file and sensors.js — nothing else needs to change.

const CONFIG = Object.freeze({

  // ── VIBRATION MODES ─────────────────────────────────────
  // Natural frequencies (Hz) validated against FEM analysis.
  // Update these once real modal-testing data is available.
  MODE_FREQS: [12.0, 31.2, 58.7],
  DEFAULT_MODE: 1,
  DEFAULT_AMPLITUDE: 1.0,

  // ── SENSOR LAYOUT ───────────────────────────────────────
  // pos  : normalised position along span  (-1 = left abutment, +1 = right)
  // type : 'accelerometer' | 'strain'
  // pin  : CSS left/top for the HUD overlay dot
  //
  // Hardware map (ESP-32 build):
  //   S1 → Strain gauge  @ quarter-span (left)
  //   S2 → Accelerometer @ mid-span
  //   S3 → Strain gauge  @ quarter-span (right)
  SENSORS: [
    { id: 'S1', pos: -0.5, label: 'L/4 span', type: 'strain', pin: { left: '28%', top: '52%' } },
    { id: 'S2', pos: 0.0, label: 'Mid-span', type: 'accelerometer', pin: { left: '50%', top: '48%' } },
    { id: 'S3', pos: 0.5, label: '3L/4 span', type: 'strain', pin: { left: '72%', top: '52%' } },
  ],

  // ── RISK THRESHOLDS ──────────────────────────────────────
  RISK: { WARNING: 35, CRITICAL: 70 },

  // ── DATA HISTORY ─────────────────────────────────────────
  // Points retained per sensor for sparkline / ML feature window.
  // Increase to 120+ when training the predictive model.
  HISTORY_LENGTH: 60,

  // ── DEFORMATION RENDERING ────────────────────────────────
  DEFORM_SCALE: 0.008,   // visual displacement multiplier (metres)
  UI_UPDATE_EVERY: 6,       // animation frames between DOM writes

  // ── SCENE SETUP ──────────────────────────────────────────
  MODEL_FIT_SIZE: 1.8,      // target bounding-box size after auto-scale
  CAMERA_DIST_K: 1.4,      // camera distance = model diagonal × this
});