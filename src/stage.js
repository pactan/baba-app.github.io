import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const SPACING = 9; // world units between stations along X (kept clear of fit zoom-out)
const DEF_EL = 0.16; // default camera elevation (radians above the look point)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Holds the single renderer/scene/camera, lays stations out along X, pans the
// camera between them, and routes pointer gestures: a press that hits the
// active station's interactive objects becomes a fidget gesture; a press on the
// empty background becomes a horizontal page swipe. That separation is what
// keeps in-fidget gestures from fighting the swipe.
export class Stage {
  constructor(canvas, ctx) {
    this.ctx = ctx;
    this.stations = [];
    this.current = 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.background = Stage._backdrop(); // soft studio gradient behind the toy

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    // The camera orbits the current station on a sphere (azimuth/elevation),
    // at a fitted distance. Two-finger drag rotates it; pinch zooms; paging
    // re-centers to the front. One finger is left for interaction / swiping.
    this.lookY = 1.0; this.lookYTarget = 1.0;
    this.camX = 0; this.camTargetX = 0;
    this.dist = 8; this.distTarget = 8;
    this.az = 0; this.azTarget = 0;            // 0 = front
    this.el = DEF_EL; this.elTarget = DEF_EL;  // elevation above the look point
    this.zoom = 1; this.zoomTarget = 1;        // pinch multiplier on distance

    this._setupEnv();
    this._setupLights();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.clock = new THREE.Clock();

    this._bindResize();
    this._bindPointer(canvas);
  }

  _setupEnv() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(env, 0.04).texture;
    env.dispose();
  }

  _setupLights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x16181d, 0.45));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    const d = 4.5; // tight frustum around one station => crisper shadows + cheaper
    Object.assign(key.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
    key.shadow.bias = -0.0004;
    key.shadow.radius = 7; // soft, diffuse studio shadow
    this.scene.add(key);
    this.scene.add(key.target); // so the shadow frustum can follow the active station
    this.key = key;

    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.6);
    fill.position.set(-4, 2.5, 3);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.7);
    rim.position.set(0, 3, -5); // back rim for a clean product-render edge
    this.scene.add(rim);
  }

  // A subtle radial studio gradient used as the scene background.
  static _backdrop() {
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 128;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(32, 46, 8, 32, 70, 110);
    grad.addColorStop(0, '#1b1e26');
    grad.addColorStop(0.55, '#0c0e12');
    grad.addColorStop(1, '#050609');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 128);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // Soft radial AO blob under an object — grounds it far better than the shadow
  // map alone, and is nearly free.
  static contactShadow(radius = 1, opacity = 0.5) {
    const size = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `rgba(0,0,0,${opacity})`);
    grad.addColorStop(0.5, `rgba(0,0,0,${opacity * 0.5})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.001;
    mesh.renderOrder = -1;
    return mesh;
  }

  add(station) {
    const i = this.stations.length;
    station.group.position.x = i * SPACING;
    station.build();
    this.scene.add(station.group);
    this.stations.push(station);
    return station;
  }

  goTo(i) {
    const prev = this.current;
    this.current = Math.max(0, Math.min(this.stations.length - 1, i));
    if (prev !== this.current) {
      this.stations[prev]?.onLeave?.();
      this.stations[this.current]?.onEnter?.();
    }
    this.camTargetX = this.current * SPACING;
    // Re-center the view on each toy (front, default elevation, no zoom).
    this.azTarget = 0; this.elTarget = DEF_EL; this.zoomTarget = 1;
    this.stations.forEach((s, k) => { s.isCurrent = (k === this.current); });
    this._applyFrame();
    this.ctx.onPageChange?.(this.current, this.stations[this.current]);
  }

  resetView() { this.azTarget = 0; this.elTarget = DEF_EL; this.zoomTarget = 1; }

  next() { this.goTo(this.current + 1); }
  prev() { this.goTo(this.current - 1); }

  // Camera distance needed to fit a frame given the current aspect ratio.
  _distFor(f) {
    const vFov = (this.camera.fov * Math.PI) / 180;
    const tanV = Math.tan(vFov / 2);
    const dV = f.halfH / tanV;
    const dH = f.halfW / (tanV * this.camera.aspect);
    return Math.max(dV, dH) * 1.08 + 0.4;
  }

  _applyFrame() {
    const s = this.stations[this.current];
    const f = s && s.frame ? s.frame() : { y: 1.0, halfW: 2.5, halfH: 1.6 };
    this.distTarget = this._distFor(f);
    this.lookYTarget = f.y;
  }

  _bindResize() {
    const resize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this._applyFrame();
    };
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    resize();
  }

  _updatePointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  _pick() {
    const s = this.stations[this.current];
    if (!s || !s.interactive.length) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(s.interactive, true);
    return hits.length ? hits[0] : null;
  }

  _bindPointer(canvas) {
    const ptrs = new Map();      // pointerId -> {x, y}
    let mode = null;             // 'station' | 'page' | 'orbit'
    let gId = null;              // the pointer that owns a single-finger gesture
    let startX = 0, startY = 0, swiped = false;
    let orbCx = 0, orbCy = 0, orbDist = 0;

    const centroid = () => {
      let x = 0, y = 0; for (const p of ptrs.values()) { x += p.x; y += p.y; }
      const n = ptrs.size || 1; return { x: x / n, y: y / n };
    };
    const spread = () => {
      const a = [...ptrs.values()]; if (a.length < 2) return 0;
      return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
    };

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture?.(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (ptrs.size >= 2) {
        // Second finger down => orbit. Abandon any single-finger gesture.
        if (mode === 'station') this.stations[this.current].onUp?.(this.pointer.clone());
        mode = 'orbit'; gId = null;
        const c = centroid(); orbCx = c.x; orbCy = c.y; orbDist = spread();
        return;
      }

      this._updatePointer(e);
      const hit = this._pick();
      const s = this.stations[this.current];
      if (hit && s.onDown) {
        mode = 'station'; gId = e.pointerId;
        s.onDown(hit, this.pointer.clone());
      } else {
        mode = 'page'; gId = e.pointerId;
        startX = e.clientX; startY = e.clientY; swiped = false;
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (mode === 'orbit' && ptrs.size >= 2) {
        const c = centroid();
        this.azTarget -= (c.x - orbCx) * 0.006;
        this.elTarget = clamp(this.elTarget - (c.y - orbCy) * 0.006, -0.25, 1.35);
        orbCx = c.x; orbCy = c.y;
        const sp = spread();
        if (orbDist > 0 && sp > 0) this.zoomTarget = clamp(this.zoomTarget * (orbDist / sp), 0.55, 1.8);
        orbDist = sp;
        return;
      }
      if (e.pointerId !== gId) return;
      this._updatePointer(e);
      if (mode === 'station') {
        this.stations[this.current].onMove?.(this._pick(), this.pointer.clone());
      } else if (mode === 'page' && !swiped) {
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) {
          swiped = true;
          dx < 0 ? this.next() : this.prev();
          this.ctx.onSwipe?.();
        }
      }
    });

    const end = (e) => {
      ptrs.delete(e.pointerId);
      if (mode === 'station' && e.pointerId === gId) {
        this.stations[this.current].onUp?.(this.pointer.clone());
      }
      if (mode === 'orbit') {
        // Wait until all fingers lift before allowing a new gesture.
        if (ptrs.size === 0) { mode = null; gId = null; }
      } else if (e.pointerId === gId) {
        mode = null; gId = null;
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') this.next();
      if (e.key === 'ArrowLeft') this.prev();
      if (e.key === 'ArrowUp') this.azTarget += 0.3;
      if (e.key === 'ArrowDown') this.azTarget -= 0.3;
    });
  }

  start() {
    // Snap to the first station's framing so there's no opening fly-in.
    this._applyFrame();
    this.camX = this.camTargetX;
    this.dist = this.distTarget;
    this.lookY = this.lookYTarget;
    this.stations.forEach((s, k) => { s.isCurrent = (k === this.current); });

    const loop = () => {
      requestAnimationFrame(loop);
      const dt = this.clock.getDelta();
      const t = this.clock.elapsedTime;

      // Smooth pan + zoom + orbit toward their targets.
      const k = Math.min(1, dt * 7);
      this.camX += (this.camTargetX - this.camX) * k;
      this.dist += (this.distTarget - this.dist) * k;
      this.lookY += (this.lookYTarget - this.lookY) * k;
      this.az += (this.azTarget - this.az) * k;
      this.el += (this.elTarget - this.el) * k;
      this.zoom += (this.zoomTarget - this.zoom) * k;

      const d = this.dist * this.zoom;
      const ce = Math.cos(this.el);
      this.camera.position.set(
        this.camX + d * Math.sin(this.az) * ce,
        this.lookY + d * Math.sin(this.el),
        d * Math.cos(this.az) * ce
      );
      this.camera.lookAt(this.camX, this.lookY, 0);

      // Keep the key light + shadow frustum over the active station.
      this.key.position.set(this.camX + 3, 6, 4);
      this.key.target.position.set(this.camX, 0.9, 0);
      this.key.target.updateMatrixWorld();

      this.stations.forEach((s, i) => {
        const near = Math.abs(i - this.current) <= 1;
        s.group.visible = near; // only render the visible station(s)
        if (near) s.update(dt, t);
      });

      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }
}

export { SPACING };
