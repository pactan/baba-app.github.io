import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const SPACING = 7; // world units between stations along X

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
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c0d11);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(0, 1.25, 7);
    this.camTargetX = 0;
    this._look = new THREE.Vector3(0, 0.35, 0);

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
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x20232c, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    const d = 8;
    Object.assign(key.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
    this.scene.add(key);
    this.key = key;

    const fill = new THREE.DirectionalLight(0x88aaff, 0.5);
    fill.position.set(-4, 2, 2);
    this.scene.add(fill);
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
    this.current = Math.max(0, Math.min(this.stations.length - 1, i));
    this.camTargetX = this.current * SPACING;
    this.ctx.onPageChange?.(this.current, this.stations[this.current]);
  }

  next() { this.goTo(this.current + 1); }
  prev() { this.goTo(this.current - 1); }

  _bindResize() {
    const resize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
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
    let mode = null;       // 'station' | 'page'
    let startX = 0, startY = 0, swiped = false;

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture?.(e.pointerId);
      this._updatePointer(e);
      const hit = this._pick();
      const s = this.stations[this.current];
      if (hit && s.onDown) {
        mode = 'station';
        s.onDown(hit, this.pointer.clone());
      } else {
        mode = 'page';
        startX = e.clientX; startY = e.clientY; swiped = false;
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!mode) return;
      this._updatePointer(e);
      const s = this.stations[this.current];
      if (mode === 'station') {
        s.onMove?.(this._pick(), this.pointer.clone());
      } else if (!swiped) {
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) {
          swiped = true;
          dx < 0 ? this.next() : this.prev();
          this.ctx.onSwipe?.();
        }
      }
    });

    const end = (e) => {
      if (mode === 'station') this.stations[this.current].onUp?.(this.pointer.clone());
      mode = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') this.next();
      if (e.key === 'ArrowLeft') this.prev();
    });
  }

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = this.clock.getDelta();
      const t = this.clock.elapsedTime;

      // Smooth camera pan toward the current station.
      this.camera.position.x += (this.camTargetX - this.camera.position.x) * Math.min(1, dt * 7);
      this._look.x += (this.camTargetX - this._look.x) * Math.min(1, dt * 7);
      this.camera.lookAt(this._look);

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
