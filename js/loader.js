// js/loader.js

function loadBridgeModel(scene, camera, controls) {
  setLoadMsg('Fetching bridge.glb…');

  const loader = new THREE.GLTFLoader();

  loader.load(
    'bridge.glb',

    function onSuccess(gltf) {
      setLoadMsg('Processing geometry…');
      const model = gltf.scene;

      const box         = new THREE.Box3().setFromObject(model);
      const size        = box.getSize(new THREE.Vector3());
      const center      = box.getCenter(new THREE.Vector3());
      const maxDim      = Math.max(size.x, size.y, size.z);
      const scaleFactor = CONFIG.MODEL_FIT_SIZE / maxDim;

      model.scale.setScalar(scaleFactor);
      model.position.sub(center.multiplyScalar(scaleFactor));

      const box2 = new THREE.Box3().setFromObject(model);
      model.position.y -= box2.min.y;

      scene.add(model);

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

        const orig = geo.attributes.position.array.slice();
        originalPositions.push({ mesh: child, orig });
        cacheMeshBounds(child);

        const n      = geo.attributes.position.count;
        const colors = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          colors[i * 3]     = 0.10;
          colors[i * 3 + 1] = 0.35;
          colors[i * 3 + 2] = 0.40;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        child.material.vertexColors = true;
      });

      const elSrc   = document.getElementById('info-src');
      const elVerts = document.getElementById('info-verts');
      const elObjs  = document.getElementById('info-objs');
      const elScale = document.getElementById('info-scale');

      if (elSrc)   elSrc.textContent   = 'bridge.glb';
      if (elVerts) elVerts.textContent = totalVerts.toLocaleString();
      if (elObjs)  elObjs.textContent  = objCount;
      if (elScale) elScale.textContent = `${scaleFactor.toFixed(4)}×`;

      // ── FIXED CAMERA POSITION ────────────────────────────
      // Frames the bridge from a slightly elevated front angle.
      // Never changes after this — bridge is static.
      const finalBox  = new THREE.Box3().setFromObject(model);
      const finalSize = finalBox.getSize(new THREE.Vector3());
      const dist      = finalSize.length() * CONFIG.CAMERA_DIST_K;

      camera.position.set(0, dist * 0.28, dist * 0.85);
      camera.lookAt(0, finalSize.y * 0.25, 0);
      camera.updateProjectionMatrix();

      // controls is null — no update needed
      if (controls) controls.update();

      setLoadMsg('Ready.');
      setTimeout(() => {
        hideLoadingScreen();
        setStatusText('LIVE — SIMULATED DATA');
      }, 500);
    },

    function onProgress(xhr) {
      if (xhr.lengthComputable) {
        const pct = Math.round((xhr.loaded / xhr.total) * 100);
        setLoadMsg(`Loading… ${pct}%`);
      }
    },

    function onError(err) {
      console.error('GLB load error:', err);
      showErrorScreen(
        err.message || 'bridge.glb not found — is the server running?'
      );
    }
  );
}