// loader.js
// Loads bridge.glb, auto-scales it, prepares geometry for deformation,
// and populates the originalPositions array used by deformation.js.

function loadBridgeModel(scene, camera, controls) {
  setLoadMsg('Fetching bridge.glb…');

  const loader = new THREE.GLTFLoader();

  loader.load(
    'bridge.glb',

    // ── ON SUCCESS ──────────────────────────────────────
    function(gltf) {
      setLoadMsg('Processing geometry…');

      const model = gltf.scene;

      // ── AUTO SCALE & CENTER ────────────────────────────
      const box        = new THREE.Box3().setFromObject(model);
      const size       = box.getSize(new THREE.Vector3());
      const center     = box.getCenter(new THREE.Vector3());
      const maxDim     = Math.max(size.x, size.y, size.z);
      const scaleFactor = 1.8 / maxDim;           // fit into ~1.8 unit cube

      model.scale.setScalar(scaleFactor);
      model.position.sub(center.multiplyScalar(scaleFactor));

      // Sit on the grid (y = 0)
      const box2 = new THREE.Box3().setFromObject(model);
      model.position.y -= box2.min.y;

      scene.add(model);

      // ── PREPARE MESHES ────────────────────────────────
      let totalVerts = 0;
      let objCount   = 0;

      model.traverse(child => {
        if (!child.isMesh) return;
        objCount++;

        // Phong material with vertex colors enabled for heatmap
        child.material = new THREE.MeshPhongMaterial({
          color:        child.material.color || new THREE.Color(0x334455),
          vertexColors: false,
          shininess:    50,
          transparent:  true,
          opacity:      0.95,
        });
        child.castShadow    = true;
        child.receiveShadow = true;

        const geo = child.geometry;
        if (!geo.attributes.position) return;

        totalVerts += geo.attributes.position.count;

        // Store original vertex positions for deformation reset
        const orig = geo.attributes.position.array.slice();
        originalPositions.push({ mesh: child, orig });

        // Add vertex color buffer (initial color = dark teal)
        const colors = new Float32Array(geo.attributes.position.count * 3);
        for (let i = 0; i < colors.length; i += 3) {
          colors[i] = 0.1; colors[i + 1] = 0.35; colors[i + 2] = 0.4;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        child.material.vertexColors = true;
      });

      // ── UPDATE MODEL INFO PANEL ────────────────────────
      document.getElementById('info-src').textContent   = 'bridge.glb';
      document.getElementById('info-verts').textContent = totalVerts.toLocaleString();
      document.getElementById('info-objs').textContent  = objCount;
      document.getElementById('info-scale').textContent = `${scaleFactor.toFixed(4)}×`;

      // ── REPOSITION CAMERA TO FIT MODEL ────────────────
      const finalBox  = new THREE.Box3().setFromObject(model);
      const finalSize = finalBox.getSize(new THREE.Vector3());
      const dist      = finalSize.length() * 1.4;
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
    function(xhr) {
      if (xhr.lengthComputable) {
        const pct = Math.round((xhr.loaded / xhr.total) * 100);
        setLoadMsg(`Loading… ${pct}%`);
      }
    },

    // ── ON ERROR ─────────────────────────────────────────
    function(err) {
      console.error('GLB load error:', err);
      showErrorScreen(
        err.message || 'bridge.glb not found — is the Python server running?'
      );
    }
  );
}
