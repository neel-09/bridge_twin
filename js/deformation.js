// deformation.js
// Handles all mesh deformation and vertex color heatmap updates.
// Works on the originalPositions array populated by loader.js.

const originalPositions = [];  // filled by loader.js after GLB loads

// ── MODE SHAPE FUNCTION ───────────────────────────────────
// Returns the normalised deflection (-1 to +1) at position normX (0 to 1)
// for a given vibration mode number.
function getModeShape(normX, mode) {
  if (mode === 1) return Math.sin(Math.PI * normX);           // 1st bending mode
  if (mode === 2) return Math.sin(2 * Math.PI * normX);       // 2nd bending mode
  if (mode === 3) return Math.sin(3 * Math.PI * normX);       // 3rd bending mode
  return 0;
}

// ── MAIN DEFORMATION UPDATE ──────────────────────────────
// Called every animation frame.
// Returns maxDeflection in mm for the HUD display.
function updateDeformation(timestamp, currentMode, amplitude, crackRisk, modeFreqs) {
  if (originalPositions.length === 0) return 0;

  const freq      = modeFreqs[currentMode - 1];
  const dispScale = amplitude * 0.008;
  let   maxDefl   = 0;

  originalPositions.forEach(({ mesh, orig }) => {
    const pos = mesh.geometry.attributes.position;
    const col = mesh.geometry.attributes.color;
    if (!col) return;

    // Bounding box used to normalise X position along the bridge span
    const box     = new THREE.Box3().setFromBufferAttribute(pos);
    const boxSize = box.getSize(new THREE.Vector3());
    const boxMin  = box.min;

    for (let i = 0; i < pos.count; i++) {
      const ox = orig[i * 3];
      const oy = orig[i * 3 + 1];
      const oz = orig[i * 3 + 2];

      // Normalise X along span (0 at left tower, 1 at right tower)
      const normX = boxSize.x > 0 ? (ox - boxMin.x) / boxSize.x : 0.5;
      const shape = getModeShape(normX, currentMode);

      // Sinusoidal displacement applied on Y axis (vertical)
      const dy = shape * dispScale * Math.sin(2 * Math.PI * freq * timestamp * 0.001);
      pos.setXYZ(i, ox, oy + dy, oz);
      if (Math.abs(dy) > maxDefl) maxDefl = Math.abs(dy);

      // ── VERTEX COLOR HEATMAP ──────────────────────────
      // Green = low stress/risk → Yellow → Red = high stress/risk
      const stress   = Math.abs(shape);
      const riskF    = crackRisk / 100;
      const combined = stress * (0.5 + riskF * 0.5);

      let r, g, b;
      if (combined < 0.4) {
        // Green → Yellow
        const f = combined / 0.4;
        r = 0.05 + f * 0.6;
        g = 0.35 + f * 0.2;
        b = 0.4  - f * 0.1;
      } else {
        // Yellow → Red
        const f = (combined - 0.4) / 0.6;
        r = 0.65 + f * 0.35;
        g = 0.55 - f * 0.55;
        b = 0.3  - f * 0.3;
      }

      // Boost red channel at high crack risk zones
      r = Math.min(1, r + riskF * stress * 0.4);
      g = Math.max(0, g - riskF * stress * 0.3);
      col.setXYZ(i, r, g, b);
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  });

  return maxDefl * 1000;  // metres → mm
}

// ── RESET ─────────────────────────────────────────────────
// Restores all vertices to their original positions
function resetDeformation() {
  originalPositions.forEach(({ mesh, orig }) => {
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]);
    }
    pos.needsUpdate = true;
  });
}
