// Lightweight ambient WebGL backdrop for the closing CTA: a few soft, slow-drifting shapes
// in the brand gradient colors, sitting quietly behind the copy. Motivation: gives the closing
// moment the same "real system, not a static poster" depth cue as the hero, at near-zero cost
// (small canvas, few low-poly meshes, paused whenever off-screen).
function BayshireAmbientScene(opts) {
  const { canvasEl } = opts;
  const THREE = window.THREE;
  let renderer, scene, camera, meshes = [];
  let running = false, built = false, alive = true, lastT = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function theme() { return BayshireThreeTheme(); }

  function applyTheme() {
    if (!built) return;
    const t = theme();
    meshes.forEach((m, i) => m.material.color.setHex([t.g1, t.g2, t.g3][i % 3]));
  }

  function build() {
    const el = canvasEl;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, el.clientWidth / el.clientHeight, 1, 100);
    camera.position.set(0, 0, 18);

    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6); dir.position.set(6, 8, 10); scene.add(dir);

    const t = theme();
    const colors = [t.g1, t.g2, t.g3];
    const geo = new THREE.IcosahedronGeometry(1, 1);
    // Kept to the far edges/back so they never sit directly behind the headline or CTA.
    const positions = [[-9.5, 3.2, -8], [9, -3, -10], [-8.5, -3.4, -6], [8.5, 3.4, -7]];
    positions.forEach((p, i) => {
      const mat = new THREE.MeshStandardMaterial({ color: colors[i % 3], roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.28 });
      const m = new THREE.Mesh(geo, mat);
      const s = 0.7 + (i % 3) * 0.3;
      m.scale.setScalar(s);
      m.position.set(p[0], p[1], p[2]);
      m.userData.baseY = p[1];
      m.userData.phase = i * 1.3;
      m.userData.speed = 0.15 + i * 0.03;
      meshes.push(m);
      scene.add(m);
    });

    new ResizeObserver(() => resize()).observe(el);
    built = true;

    if (reduced) renderer.render(scene, camera);
  }

  function resize() {
    if (!built || !canvasEl.clientWidth) return;
    renderer.setSize(canvasEl.clientWidth, canvasEl.clientHeight);
    camera.aspect = canvasEl.clientWidth / canvasEl.clientHeight;
    camera.updateProjectionMatrix();
    if (!running) renderer.render(scene, camera);
  }

  function tick(t) {
    if (!running || !alive) return;
    requestAnimationFrame(tick);
    const dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 1 / 60; lastT = t;
    const s = t / 1000;
    meshes.forEach(m => {
      m.rotation.x += dt * m.userData.speed * 0.6;
      m.rotation.y += dt * m.userData.speed;
      m.position.y = m.userData.baseY + Math.sin(s * m.userData.speed + m.userData.phase) * 0.6;
    });
    renderer.render(scene, camera);
  }

  return {
    start() {
      if (reduced) { if (!built) build(); return; } // static render only, no loop
      if (!built) build();
      if (running) return;
      running = true; lastT = 0;
      requestAnimationFrame(tick);
    },
    stop() { running = false; },
    applyTheme,
    destroy() { alive = false; running = false; if (renderer) renderer.dispose(); }
  };
}
