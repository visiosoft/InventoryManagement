// Interactive 3D unit picker for the Units section. Same isometric box-geometry approach as
// the hero scene, but static-framed, drag-to-rotate, and raycast-selectable instead of scroll-tied.
function BayshireUnitsScene(opts) {
  const { canvasEl, units, getSelectedCode, onSelect } = opts;
  const THREE = window.THREE;
  let renderer, scene, camera, group, raycaster, pointer;
  let meshByCode = {}, materials = [];
  let running = false, built = false, alive = true, lastT = 0;
  let rotY = -0.5, dragging = false, dragStartX = 0, dragStartRot = 0, dragged = false;
  let highlight;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function theme() { return BayshireThreeTheme(); }

  function applyTheme() {
    if (!built) return;
    const t = theme();
    scene.fog.color.setHex(t.bg);
    const key = { Available: 'avail', Occupied: 'occ', Reserved: 'res', Maintenance: 'maint' };
    materials.forEach(m => { m.mat.color.setHex(t[key[m.status]]); m.edge.color.setHex(t.edge); m.edge.opacity = t.edgeOp; });
  }

  function build() {
    const el = canvasEl;
    const W = 42, D = 23;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cursor = 'grab';

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(theme().bg, 45, 120);
    camera = new THREE.PerspectiveCamera(28, el.clientWidth / el.clientHeight, 1, 400);
    camera.position.set(30, 26, 34);
    camera.lookAt(0, 1.5, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f8a, 1.15));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2); dir.position.set(25, 40, 15); scene.add(dir);

    group = new THREE.Group();
    group.rotation.y = rotY;
    scene.add(group);

    const floorMat = new THREE.MeshStandardMaterial({ roughness: 1, color: theme().floor });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; group.add(floor);
    const grid = new THREE.GridHelper(W, 21); grid.scale.z = D / W; grid.material.transparent = true; grid.material.opacity = 0.5;
    group.add(grid);

    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    const edgesGeo = new THREE.EdgesGeometry(box);
    const key = { Available: 'avail', Occupied: 'occ', Reserved: 'res', Maintenance: 'maint' };
    const t = theme();

    units.forEach(u => {
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, color: t[key[u.status]] });
      const m = new THREE.Mesh(box, mat);
      const sw = u.w - 0.25, sd = u.d - 0.25;
      m.scale.set(sw, u.h, sd);
      m.position.set(u.x + u.w / 2 - W / 2, 0, u.z + u.d / 2 - D / 2);
      const edge = new THREE.LineBasicMaterial({ transparent: true, opacity: t.edgeOp, color: t.edge });
      m.add(new THREE.LineSegments(edgesGeo, edge));
      m.userData.code = u.code;
      materials.push({ mat, edge, status: u.status });
      meshByCode[u.code] = m;
      group.add(m);
    });

    const ringGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    highlight = new THREE.LineSegments(ringGeo, new THREE.LineBasicMaterial({ color: 0x4285F4, linewidth: 2, transparent: true, opacity: 0.9 }));
    highlight.renderOrder = 10;
    group.add(highlight);

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('click', onClick);
    new ResizeObserver(() => resize()).observe(el);

    built = true;
    updateHighlight();
  }

  function onPointerDown(e) {
    dragging = true; dragged = false; dragStartX = e.clientX; dragStartRot = group.rotation.y;
    renderer.domElement.style.cursor = 'grabbing';
  }
  function onPointerMove(e) {
    if (!dragging) return;
    const dx = e.clientX - dragStartX;
    if (Math.abs(dx) > 3) dragged = true;
    group.rotation.y = dragStartRot + dx * 0.008;
    rotY = group.rotation.y;
  }
  function onPointerUp() {
    dragging = false;
    if (renderer) renderer.domElement.style.cursor = 'grab';
  }
  function onClick(e) {
    if (dragged) return; // was a drag, not a tap/click
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(group.children.filter(c => c.userData.code), false);
    if (hits.length) onSelect(hits[0].object.userData.code);
  }

  function updateHighlight() {
    if (!built) return;
    const code = getSelectedCode();
    const m = meshByCode[code];
    if (!m) { highlight.visible = false; return; }
    highlight.visible = true;
    highlight.position.copy(m.position);
    highlight.scale.copy(m.scale).multiplyScalar(1.0);
    highlight.scale.set(m.scale.x * 1.03, m.scale.y * 1.01, m.scale.z * 1.03);
  }

  function resize() {
    if (!built || !canvasEl.clientWidth) return;
    renderer.setSize(canvasEl.clientWidth, canvasEl.clientHeight);
    camera.aspect = canvasEl.clientWidth / canvasEl.clientHeight;
    camera.updateProjectionMatrix();
  }

  function tick(t) {
    if (!running || !alive) return;
    requestAnimationFrame(tick);
    const dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 1 / 60; lastT = t;
    if (!reduced && !dragging) group.rotation.y += dt * 0.05; // gentle ambient spin when idle
    renderer.render(scene, camera);
  }

  return {
    start() {
      if (!built) build();
      if (running) return;
      running = true; lastT = 0;
      requestAnimationFrame(tick);
    },
    stop() { running = false; },
    setSelected() { updateHighlight(); },
    applyTheme,
    destroy() { alive = false; running = false; if (renderer) renderer.dispose(); }
  };
}
