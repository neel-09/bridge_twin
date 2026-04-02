// loader.js
// Loads bridge.glb, auto-scales, sets up geometry for deformation,
// and calls cacheMeshBounds() so deformation.js never has to recompute it.

function loadBridgeModel(scene, camera, controls) {
  setLoadMsg('Fetching bridge.glb…');

  const loader = new THREE.GLTFLoader();

  loader.load(
    'bridge.glb',

    // ── ON SUCCESS ──────────────────────────────────────
    function onSuccess(gltf) {
      setLoadMsg('Processing geometry…');
      const model = gltf.scene;

      // ── AUTO SCALE & CENTER ────────────────────────────
      const box         = new THREE.Box3().setFromObject(model);
      const size        = box.getSize(new THREE.Vector3());
      const center      = box.getCenter(new THREE.Vector3());
      const maxDim      = Math.max(size.x, size.y, size.z);
      const scaleFactor = CONFIG.MODEL_FIT_SIZE / maxDim;

      model.scale.setScalar(scaleFactor);
      model.position.sub(center.multiplyScalar(scaleFactor));

      // Sit flush on the grid
      const box2 = new THREE.Box3().setFromObject(model);
      model.position.y -= box2.min.y;

      scene.add(model);

      // ── PREPARE MESHES ────────────────────────────────
      let totalVerts = 0, objCount = 0;

      model.traverse(child => {
        if (!child.isMesh) return;
        objCount++;

        child.material = new THREE.MeshPhongMaterial({
          color:       child.material.color || new THREE.Color(0x334455),
          shininess:   50,
          transparent: true,
          opacity:     0.95,
        });
        child.castShadow    = true;
        child.receiveShadow = true;

        const geo = child.geometry;
        if (!geo.attributes.position) return;

        totalVerts += geo.attributes.position.count;

        // Store originals for deformation reset
        const orig = geo.attributes.position.array.slice();
        originalPositions.push({ mesh: child, orig });

        // Cache bounding box ONCE here — never again per-frame
        cacheMeshBounds(child);

        // Vertex colour buffer (initial dark-teal)
        const n      = geo.attributes.position.count;
        const colors = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          colors[i * 3]     = 0.1;
          colors[i * 3 + 1] = 0.35;
          colors[i * 3 + 2] = 0.40;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        child.material.vertexColors = true;
      });

      // ── MODEL INFO PANEL ──────────────────────────────
      document.getElementById('info-src').textContent   = 'bridge.glb';
      document.getElementById('info-verts').textContent = totalVerts.toLocaleString();
      document.getElementById('info-objs').textContent  = objCount;
      document.getElementById('info-scale').textContent = `${scaleFactor.toFixed(4)}×`;

      // ── CAMERA FIT ────────────────────────────────────
      const finalBox  = new THREE.Box3().setFromObject(model);
      const finalSize = finalBox.getSize(new THREE.Vector3());
      const dist      = finalSize.length() * CONFIG.CAMERA_DIST_K;
      camera.position.set(0, dist * 0.4, dist * 0.9);
      controls.target.set(0, finalSize.y * 0.3, 0);
      controls.update();

      setLoadMsg('Ready.');
      setTimeout(() => {
        hideLoadingScreen();
        setStatusText('LIVE — SIMULATED DATA');
      }, 500);
    },

    // ── ON PROGRESS ──────────────────────────────────────
    function onProgress(xhr) {
      if (xhr.lengthComputable) {
        const pct = Math.round((xhr.loaded / xhr.total) * 100);
        setLoadMsg(`Loading… ${pct}%`);
      }
    },

    // ── ON ERROR ─────────────────────────────────────────
    function onError(err) {
      console.error('GLB load error:', err);
      showErrorScreen(
        err.message || 'bridge.glb not found — is the Python server running?'
      );
    }
  );
}