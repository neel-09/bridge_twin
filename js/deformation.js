// deformation.js
// Mesh deformation and vertex-colour heatmap.
// Bounding boxes are CACHED once after model load — never recalculated
// per-frame (the original code was allocating hundreds of objects / second).

const originalPositions = [];       // populated by loader.js
const _meshCache = new WeakMap();   // mesh → { minX, spanX } — set by cacheMeshBounds()

// ── CACHE (called once per mesh from loader.js) ───────────
// Extracts only the X-span data we need for mode-shape normalisation.
function cacheMeshBounds(mesh) {
  const arr = mesh.geometry.attributes.position.array;
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < arr.length; i += 3) {
    if (arr[i] < minX) minX = arr[i];
    if (arr[i] > maxX) maxX = arr[i];
  }
  _meshCache.set(mesh, { minX, spanX: maxX - minX });
}

// ── MODE SHAPE ────────────────────────────────────────────
function getModeShape(normX, mode) {
  switch (mode) {
    case 1: return Math.sin(Math.PI       * normX);
    case 2: return Math.sin(2 * Math.PI  * normX);
    case 3: return Math.sin(3 * Math.PI  * normX);
    default: return 0;
  }
}

// ── MAIN DEFORMATION UPDATE ───────────────────────────────
// Returns maxDeflection in mm for the HUD display.
function updateDeformation(timestamp, mode, amplitude, crackRisk) {
  if (originalPositions.length === 0) return 0;

  const validMode  = mode >= 1 && mode <= CONFIG.MODE_FREQS.length;
  const freq       = validMode ? CONFIG.MODE_FREQS[mode - 1] : 0;
  const dispScale  = amplitude * CONFIG.DEFORM_SCALE;
  const riskF      = crackRisk / 100;
  const sinT       = validMode
    ? Math.sin(2 * Math.PI * freq * timestamp * 0.001)
    : 0;

  let maxDefl = 0;

  originalPositions.forEach(({ mesh, orig }) => {
    const pos    = mesh.geometry.attributes.position;
    const col    = mesh.geometry.attributes.color;
    if (!col) return;

    const cache = _meshCache.get(mesh);
    if (!cache) return;
    const { minX, spanX } = cache;

    for (let i = 0; i < pos.count; i++) {
      const ox = orig[i * 3];
      const oy = orig[i * 3 + 1];
      const oz = orig[i * 3 + 2];

      const normX = spanX > 0 ? (ox - minX) / spanX : 0.5;
      const shape = getModeShape(normX, mode);
      const dy    = shape * dispScale * sinT;

      pos.setXYZ(i, ox, oy + dy, oz);
      if (Math.abs(dy) > maxDefl) maxDefl = Math.abs(dy);

      // ── VERTEX COLOR HEATMAP ──────────────────────────
      const stress   = Math.abs(shape);
      const combined = stress * (0.5 + riskF * 0.5);

      let r, g, b;
      if (combined < 0.4) {
        const f = combined / 0.4;
        r = 0.05 + f * 0.60;
        g = 0.35 + f * 0.20;
        b = 0.40 - f * 0.10;
      } else {
        const f = (combined - 0.4) / 0.6;
        r = 0.65 + f * 0.35;
        g = 0.55 - f * 0.55;
        b = 0.30 - f * 0.30;
      }
      r = Math.min(1, r + riskF * stress * 0.4);
      g = Math.max(0, g - riskF * stress * 0.3);
      col.setXYZ(i, r, g, b);
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  });

  return maxDefl * 1000;   // metres → mm
}

// ── RESET ─────────────────────────────────────────────────
function resetDeformation() {
  originalPositions.forEach(({ mesh, orig }) => {
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  });
}