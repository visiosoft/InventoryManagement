// Shared palette for every Three.js scene on the page (hero, units picker, ambient CTA backdrop),
// kept in one place so light/dark retints stay consistent across scenes.
function BayshireThreeTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  return dark
    ? { bg: 0x131314, floor: 0x1B1B1D, grid: 0x2E2F31, edge: 0xE3E3E3, edgeOp: 0.09, avail: 0x232426, occ: 0x2E5A3C, res: 0x5A4A1C, maint: 0x5E2A26, hemi: 0.9, dir: 1.0, iOcc: 0x6DD58C, iRes: 0xFDD663, iMaint: 0xF28B82, g1: 0x6DD58C, g2: 0x8AB4F8, g3: 0xFDD663 }
    : { bg: 0xFFFFFF, floor: 0xF8F9FA, grid: 0xE3E3E3, edge: 0x1F1F1F, edgeOp: 0.1, avail: 0xFFFFFF, occ: 0xA8DAB5, res: 0xFDE293, maint: 0xF6AEA9, hemi: 1.15, dir: 1.3, iOcc: 0x34A853, iRes: 0xF9AB00, iMaint: 0xEA4335, g1: 0x34A853, g2: 0x4285F4, g3: 0xFBBC04 };
}

// Isometric storage-facility 3D scene for the hero. Ported from the design reference.
function BayshireScene(opts) {
  const { canvasEl, heroEl, textEl, metricsEl, units } = opts;
  let renderer, scene, camera, group, floorMat, grid, bound, hemi, dir, fog;
  let meshes = [], materials = [];
  let rotY = 0, rotX = 0, tRY = 0, tRX = 0, scrollP = 0, lastT = 0;
  let camTarget, introTween, introDone = false, alive = true;
  let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function theme() { return BayshireThreeTheme(); }

  function applyTheme() {
    if (!renderer) return;
    const t = theme();
    floorMat.color.setHex(t.floor);
    grid.material.color.setHex(t.grid);
    bound.material.color.setHex(t.grid);
    hemi.intensity = t.hemi;
    dir.intensity = t.dir;
    if (fog) fog.color.setHex(t.bg);
    materials.forEach(m => {
      m.mat.color.setHex(t[m.k]);
      m.edge.color.setHex(t.edge);
      m.edge.opacity = t.edgeOp;
      if (m.ind) m.ind.color.setHex(t[m.ik]);
    });
  }

  function frame() {
    const THREE = window.THREE, el = canvasEl, cam = camera;
    const w = el.clientWidth, h = el.clientHeight, hr = heroEl.getBoundingClientRect();
    const txt = textEl;
    const top = (txt ? txt.getBoundingClientRect().bottom - hr.top : h * 0.5) + 28;
    const bot = h - 16;
    const dirV = new THREE.Vector3(0.42, 0.9, 1).normalize();
    const pts = [[-21,0,-11.5],[21,0,-11.5],[-21,0,11.5],[21,0,11.5],[-21,3.2,-11.5],[21,3.2,-11.5],[-21,3.2,11.5],[21,3.2,11.5]].map(p => new THREE.Vector3(...p));
    const probe = new THREE.PerspectiveCamera(cam.fov, w / h, 1, 400), v = new THREE.Vector3();
    const proj = (dist, ty) => {
      probe.position.copy(dirV).multiplyScalar(dist).setY(dirV.y * dist + ty);
      probe.lookAt(0, ty, 0); probe.updateMatrixWorld(); probe.updateProjectionMatrix();
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      pts.forEach(p => {
        v.copy(p).project(probe);
        const sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h;
        minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
      });
      return { minX, maxX, minY, maxY };
    };
    const targetW = w * (w < 700 ? 0.98 : 0.9), maxH = h - top + 160;
    let dist = 80, ty = 0;
    for (let i = 0; i < 12; i++) {
      const b = proj(dist, ty);
      dist *= Math.max((b.maxX - b.minX) / targetW, (b.maxY - b.minY) / maxH);
      const b2 = proj(dist, ty);
      const pxPerUnit = (b2.maxX - b2.minX) / 42;
      ty -= (b2.maxY - bot) / pxPerUnit;
    }
    camTarget.set(0, ty, 0);
    return [dirV.x * dist, dirV.y * dist + ty, dirV.z * dist];
  }

  function resize() {
    const el = canvasEl;
    if (!el || !renderer || !el.clientWidth) return;
    renderer.setSize(el.clientWidth, el.clientHeight);
    camera.aspect = el.clientWidth / el.clientHeight;
    camera.updateProjectionMatrix();
    const c = frame();
    if (introDone || reduced) {
      camera.position.set(c[0], c[1], c[2]);
    } else if (introTween) {
      introTween.kill();
      introTween = window.gsap.to(camera.position, { x: c[0], y: c[1], z: c[2], duration: 1.2, ease: 'power2.out', onComplete: () => { introDone = true; } });
    }
  }

  function init() {
    const el = canvasEl;
    if (!el) return;
    const THREE = window.THREE, gsap = window.gsap;
    const mobile = window.innerWidth < 700, tablet = window.innerWidth < 1024;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    fog = new THREE.Fog(theme().bg, 40, 130);
    scene.fog = fog;
    camera = new THREE.PerspectiveCamera(mobile ? 40 : 30, el.clientWidth / el.clientHeight, 1, 400);
    camTarget = new THREE.Vector3(0, 0, 0);
    group = new THREE.Group();
    scene.add(group);
    const W = 42, D = 23;
    hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f8a, 1); scene.add(hemi);
    dir = new THREE.DirectionalLight(0xffffff, 1); dir.position.set(25, 40, 15); scene.add(dir);
    floorMat = new THREE.MeshStandardMaterial({ roughness: 1, transparent: true, opacity: 0 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; group.add(floor);
    grid = new THREE.GridHelper(W, 21);
    grid.scale.z = D / W; grid.material.transparent = true; grid.material.opacity = 0; group.add(grid);
    bound = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(W, D)), new THREE.LineBasicMaterial({ transparent: true, opacity: 0 }));
    bound.rotation.x = -Math.PI / 2; bound.position.y = 0.01; group.add(bound);

    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    const edgesGeo = new THREE.EdgesGeometry(box);
    const indGeo = new THREE.PlaneGeometry(1, 1); indGeo.rotateX(-Math.PI / 2);
    const key = { Available: 'avail', Occupied: 'occ', Reserved: 'res', Maintenance: 'maint' };
    const ikey = { Occupied: 'iOcc', Reserved: 'iRes', Maintenance: 'iMaint' };

    let list = units;
    if (mobile) list = list.filter(u => u.z > 3);
    else if (tablet) list = list.filter((u, i) => u.z > 3 || i % 2 === 0);

    meshes = list.map(u => {
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
      const m = new THREE.Mesh(box, mat);
      const sw = u.w - 0.25, sd = u.d - 0.25;
      m.scale.set(sw, 0.001, sd);
      m.position.set(u.x + u.w / 2 - W / 2, 0, u.z + u.d / 2 - D / 2);
      m.userData.h = u.h;
      m.userData.order = (u.x + u.z * 1.4) / (W + D * 1.4);
      const edge = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.18 });
      m.add(new THREE.LineSegments(edgesGeo, edge));
      const rec = { mat, edge, k: key[u.status] };
      if (ikey[u.status]) {
        const ind = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
        const im = new THREE.Mesh(indGeo, ind);
        im.position.y = 1.002; im.scale.set(0.5 / sw, 1, 0.5 / sd);
        m.add(im);
        rec.ind = ind; rec.ik = ikey[u.status];
      }
      materials.push(rec);
      group.add(m);
      return m;
    });

    applyTheme();
    const camFinal = frame();

    if (reduced) {
      floorMat.opacity = 1; grid.material.opacity = 0.9; bound.material.opacity = 1;
      meshes.forEach(m => m.scale.y = m.userData.h);
      materials.forEach(r => { if (r.ind) r.ind.opacity = 1; });
      camera.position.set(...camFinal);
    } else {
      camera.position.set(camFinal[0] * 1.25, camFinal[1] * 1.25, camFinal[2] * 1.25);
      introTween = gsap.to(camera.position, { x: camFinal[0], y: camFinal[1], z: camFinal[2], duration: 2.4, ease: 'power2.out', onComplete: () => { introDone = true; } });
      gsap.to(floorMat, { opacity: 1, duration: 0.7 });
      gsap.to(grid.material, { opacity: 0.9, duration: 0.9, delay: 0.1 });
      gsap.to(bound.material, { opacity: 1, duration: 0.9, delay: 0.1 });
      meshes.forEach(m => gsap.to(m.scale, { y: m.userData.h, duration: 0.9, ease: 'power3.out', delay: 0.35 + m.userData.order * 1.1 }));
      materials.forEach(r => { if (r.ind) gsap.to(r.ind, { opacity: 1, duration: 0.5, delay: 1.8 + Math.random() * 0.4 }); });
      if (!mobile) {
        window.addEventListener('mousemove', e => {
          tRY = (e.clientX / window.innerWidth - 0.5) * 0.14;
          tRX = (e.clientY / window.innerHeight - 0.5) * 0.06;
        }, { passive: true });
      }
    }

    const tick = t => {
      if (!alive) return;
      requestAnimationFrame(tick);
      if (scrollP >= 1) return;
      const s = t / 1000;
      const dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 1 / 60; lastT = t;
      const lerpF = 1 - Math.exp(-2.45 * dt); // frame-rate independent smoothing, tuned to match the old fixed-step 0.04-per-60fps-frame feel
      rotY += (tRY - rotY) * lerpF; rotX += (tRX - rotX) * lerpF;
      const drift = reduced ? 0 : 1;
      group.rotation.y = rotY + Math.sin(s * 0.25) * 0.02 * drift;
      group.rotation.x = rotX + Math.sin(s * 0.17) * 0.008 * drift;
      camera.lookAt(camTarget);
      renderer.render(scene, camera);
    };
    requestAnimationFrame(tick);

    if (!reduced && window.gsap && window.ScrollTrigger) {
      gsap.registerPlugin(ScrollTrigger);
      ScrollTrigger.create({
        trigger: heroEl, start: 'top top', end: 'bottom top',
        onUpdate: self => {
          const p = self.progress; scrollP = p;
          if (group) { const k = 1 - 0.32 * p; group.scale.set(k, 1 - 0.45 * p, k); group.position.y = -6 * p; }
          if (canvasEl) canvasEl.style.opacity = String(Math.max(0, 1 - p * 1.15));
          if (textEl) { textEl.style.opacity = String(Math.max(0, 1 - p * 1.9)); textEl.style.transform = 'translateY(' + (-70 * p) + 'px)'; }
          if (metricsEl) metricsEl.style.opacity = String(Math.max(0, 1 - p * 1.6));
        }
      });
    }

    new ResizeObserver(() => resize()).observe(canvasEl);
    window.addEventListener('resize', resize);
  }

  function waitFor(cond, fn, n) {
    n = n || 0;
    if (cond()) fn();
    else if (n < 200) setTimeout(() => waitFor(cond, fn, n + 1), 50);
  }

  waitFor(
    () => window.THREE && window.gsap && window.ScrollTrigger && canvasEl.clientWidth > 0 && canvasEl.clientHeight > 0,
    init
  );

  return {
    applyTheme,
    destroy() { alive = false; if (renderer) renderer.dispose(); }
  };
}
