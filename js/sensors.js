// sensors.js
// Manages all sensor state, data history, and live/simulated data switching.
// When you connect real Arduino data via WebSocket, only edit this file.

const SENSOR_HISTORY_LENGTH = 40;

// The 4 sensor objects — position is normalised (-1 to +1 along bridge length)
const sensorData = [
  { id: 'S1', pos: -0.875, risk: 0, vals: [], label: 'L/4 span'      },
  { id: 'S2', pos:  0,     risk: 0, vals: [], label: 'Center'         },
  { id: 'S3', pos:  0.875, risk: 0, vals: [], label: '3L/4 span'      },
];

// Set to true when real WebSocket data arrives — disables simulation
let usingLiveData = false;

// ── SIMULATED UPDATE ──────────────────────────────────────
// Called every frame when no real sensor is connected.
// Replace the body of this function with WebSocket data when ready.
function updateSensorsSimulated(timestamp, currentMode, amplitude, crackRisk, modeFreqs) {
  const freq = modeFreqs[currentMode - 1];

  sensorData.forEach((s, i) => {
    const normX = (s.pos + 1) / 2;
    const shape = getModeShape(normX, currentMode) * (i === 3 ? 0.3 : 1);
    const noise = (Math.random() - 0.5) * 0.015;
    const val = shape * amplitude * 0.08
              * Math.sin(2 * Math.PI * freq * timestamp * 0.001)
              + noise;

    pushSensorValue(s, val);
    s.risk = Math.min(100, Math.abs(shape) * crackRisk * 1.2);
  });
}

// ── LIVE DATA INJECTION ───────────────────────────────────
// Called by sensor_ws.js when a real WebSocket packet arrives.
// Packet format: { s1: 0.012, s2: 0.034, s3: 0.011, s4: 0.005 }
function injectLiveSensorData(packet) {
  usingLiveData = true;
  const keys = ['s1', 's2', 's3'];
  sensorData.forEach((s, i) => {
    const val = packet[keys[i]];
    if (val !== undefined) pushSensorValue(s, val);
  });
}

// ── HELPERS ───────────────────────────────────────────────
function pushSensorValue(sensor, val) {
  sensor.vals.push(val);
  if (sensor.vals.length > SENSOR_HISTORY_LENGTH) sensor.vals.shift();
}

function resetSensorData() {
  sensorData.forEach(s => { s.vals = []; s.risk = 0; });
  usingLiveData = false;
}
