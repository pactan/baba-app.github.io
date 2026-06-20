import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
// Bloom is loaded dynamically below so a missing addon can't block startup.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// --- FLUX: colour-match reflex × constant-speed runner ----------------------
const PALETTE = [0xff2e63, 0x2ee6c9, 0xffd23a, 0x6a5cff, 0xff8a3a]; // 5 vivid hues
const COLORS = PALETTE.map((h) => new THREE.Color(h));

const START_SPEED = 26;     // forward speed (units/s)
const SPEED_STEP = 0.45;    // +speed per gate cleared (escalates)
const MAX_SPEED = 60;
const GATE_GAP = 26;        // distance between gates (world units)
const N_GATES = 7;          // pooled gate count (recycled)
const SHAFT_R = 6;          // tunnel radius
const PERFECT_Z = 1.4;      // pass within this of gate centre = "perfect"

export class Game {
  constructor(canvas, audio, input, hud) {
    this.audio = audio; this.input = input; this.hud = hud;
    this.onError = null;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x05060d, GATE_GAP * 2, GATE_GAP * 5.5);
    this.scene.background = new THREE.Color(0x05060d);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 600);

    this._lights();
    this._tunnel();
    this._cube();
    this._gates();
    this._sparks();
    this._post();

    this.best = this._loadBest();
    this._reset();
    this.running = false;
    this.hud.setBest(this.best);

    this.clock = new THREE.Clock();
    addEventListener('resize', () => this._resize());
    this._resize();
  }

  _lights() {
    this.scene.add(new THREE.HemisphereLight(0x8aa0ff, 0x10121f, 0.8));
    this.keyLight = new THREE.PointLight(0xffffff, 1.2, 60, 2);
    this.scene.add(this.keyLight);
    // a coloured light at the cube that tints the tunnel with your current hue
    this.cubeLight = new THREE.PointLight(0xffffff, 2.2, 40, 2);
    this.scene.add(this.cubeLight);
  }

  // a long faintly-segmented tube the player flies down (+z)
  _tunnel() {
    const geo = new THREE.CylinderGeometry(SHAFT_R, SHAFT_R, GATE_GAP * (N_GATES + 4), 24, 1, true);
    geo.rotateX(Math.PI / 2);
    const tex = makeTunnelTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(8, 30);
    this.tunnelMat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.BackSide, roughness: 0.85, metalness: 0.1,
      emissive: 0x0a0e20, emissiveIntensity: 0.5 });
    this.tunnel = new THREE.Mesh(geo, this.tunnelMat);
    this.scene.add(this.tunnel);
  }

  _cube() {
    this.cube = new THREE.Group();
    this.cubeMat = new THREE.MeshStandardMaterial({ color: COLORS[0], roughness: 0.3, metalness: 0.1,
      emissive: COLORS[0], emissiveIntensity: 0.6 });
    const box = new THREE.Mesh(new RoundedBoxGeometry(2, 2, 2, 5, 0.22), this.cubeMat);
    this.cube.add(box);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
    this.cube.add(edges);
    this.scene.add(this.cube);
  }

  // each gate is a coloured ring with a solid disc behind it; you must match
  // the ring colour to fly through (the disc is just for readability/contrast).
  _gates() {
    this.gates = [];
    const ringGeo = new THREE.TorusGeometry(SHAFT_R - 0.4, 0.5, 12, 36);
    for (let i = 0; i < N_GATES; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.3 });
      const ring = new THREE.Mesh(ringGeo, mat);
      this.scene.add(ring);
      this.gates.push({ mesh: ring, mat, colorIdx: 0, z: 0, passed: false });
    }
  }

  _sparks() {
    const tex = makePuff();
    this.sparkMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.sparks = [];
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.sparkMat.clone());
      m.visible = false; this.scene.add(m);
      this.sparks.push({ mesh: m, life: 0, vx: 0, vy: 0, vz: 0 });
    }
    this.sparkCursor = 0;
  }

  async _post() {
    this.composer = null;
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'),
      ]);
      const c = new EffectComposer(this.renderer);
      c.addPass(new RenderPass(this.scene, this.camera));
      c.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.6, 0.82));
      c.setSize(innerWidth, innerHeight);
      this.composer = c;
    } catch (e) { this.composer = null; }
  }

  // ---------------------------------------------------------------- state --
  _reset() {
    this.z = 0;                       // how far we've flown
    this.speed = START_SPEED;
    this.colorIdx = 0;
    this.cubeMat.color.copy(COLORS[0]); this.cubeMat.emissive.copy(COLORS[0]);
    this.score = 0; this.combo = 0;
    this.over = false; this.overT = 0; this._shownResult = false;
    this.shakeAmt = 0; this.spin = 0;
    for (const s of this.sparks) { s.life = 0; s.mesh.visible = false; }
    // lay out the initial gates ahead, each a random colour
    let zz = GATE_GAP * 2.2;
    for (const g of this.gates) { this._placeGate(g, zz); zz += GATE_GAP; }
    this.hud.setScore(0); this.hud.hideResult();
  }

  _placeGate(g, z) {
    g.z = z; g.passed = false;
    g.colorIdx = Math.floor(Math.random() * COLORS.length);
    g.mat.color.copy(COLORS[g.colorIdx]); g.mat.emissive.copy(COLORS[g.colorIdx]);
    g.mesh.position.set(0, 0, z);
    g.mesh.rotation.z = 0;
  }

  start() { this._reset(); this.running = true; this.clock.getDelta(); this._loop(); }
  restart() { this._reset(); this.running = true; }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 1 / 30);
    try {
      if (this.running) this._update(dt);
      this._updateSparks(dt);
      this._render(dt);
      if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    } catch (e) { this.running = false; if (this.onError) this.onError(e); }
  }

  _update(dt) {
    if (this.over) { this.overT += dt; if (this.overT > 0.5 && !this._shownResult) { this._shownResult = true; this._finish(); } return; }

    // tap cycles colour
    if (this.input.tapped) {
      this.input.endFrame();
      this.colorIdx = (this.colorIdx + 1) % COLORS.length;
      this.cubeMat.color.copy(COLORS[this.colorIdx]); this.cubeMat.emissive.copy(COLORS[this.colorIdx]);
      this.spin = Math.PI / 2;     // a snappy quarter-turn flourish on cycle
      this.audio.cycle();
    }

    // constant forward flight (speed escalates as you score)
    this.z += this.speed * dt;
    const cubeZ = this.z + 11;             // the cube renders ahead of the flight z

    // check each gate as the cube reaches it
    for (const g of this.gates) {
      const rel = g.z - cubeZ;             // >0 ahead, <0 behind
      if (!g.passed && rel <= 0) {
        g.passed = true;
        if (g.colorIdx === this.colorIdx) {
          // PASS
          const perfect = Math.abs(rel) < PERFECT_Z * (this.speed / START_SPEED);
          this.combo++;
          const gain = (perfect ? 2 : 1) * (1 + Math.floor(this.combo / 5));
          this.score += gain;
          this.speed = clamp(this.speed + SPEED_STEP, START_SPEED, MAX_SPEED);
          if (perfect) { this.audio.perfect(this.combo); this._burst(COLORS[g.colorIdx], 14); this._shake(0.12); }
          else { this.audio.pass(this.combo); this._burst(COLORS[g.colorIdx], 7); }
          this.hud.setScore(this.score);
          this.hud.setCombo(this.combo);
          if (this.score > this.best) { this.best = this.score; this._saveBest(this.best); this.hud.setBest(this.best); }
        } else {
          // WRONG COLOUR -> crash
          this.over = true; this.overT = 0;
          this.audio.crash(); this._burst(0xffffff, 26); this._shake(1.0);
          this.hud.setCombo(0);
          return;
        }
      }
      // recycle gates that fell behind to the far end
      if (rel < -GATE_GAP) {
        let maxZ = -Infinity; for (const o of this.gates) maxZ = Math.max(maxZ, o.z);
        this._placeGate(g, maxZ + GATE_GAP);
      }
    }
  }

  _render(dt) {
    // cube sits ahead of the camera, low and small, so gates are visible coming
    this.spin = lerp(this.spin, 0, Math.min(1, dt * 8));
    const camZ = this.z;
    this.cube.position.set(0, -1.6 + Math.sin(this.z * 0.12) * 0.3, camZ + 11);
    this.cube.rotation.y += dt * 0.6;
    this.cube.rotation.x = this.spin;
    if (this.over) { this.cube.rotation.x += dt * 9; this.cube.rotation.z += dt * 7; this.cube.position.y -= dt * 6 * this.overT; }

    // keep the tunnel centred around the cube so it feels infinite
    this.tunnel.position.z = camZ;
    this.tunnelMat.map.offset.y = -camZ * 0.03;

    // camera sits well behind + above, looking down the shaft past the cube
    const sh = this.shakeAmt; this.shakeAmt *= Math.pow(0.0001, dt);
    this.camera.position.set((Math.random() - 0.5) * sh, 2.4 + (Math.random() - 0.5) * sh, camZ - 7);
    this.camera.lookAt(0, -0.5, camZ + 24);

    // lights follow; the cube light carries your current colour
    this.keyLight.position.set(0, 4, camZ + 4);
    this.cubeLight.position.copy(this.cube.position);
    this.cubeLight.color.copy(COLORS[this.colorIdx]);

    // a subtle speed pulse on FOV
    const sp01 = (this.speed - START_SPEED) / (MAX_SPEED - START_SPEED);
    this.camera.fov += (64 + sp01 * 10 - this.camera.fov) * Math.min(1, dt * 3);
    this.camera.updateProjectionMatrix();
  }

  _burst(color, n) {
    const col = (color instanceof THREE.Color) ? color : new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const p = this.sparks[this.sparkCursor]; this.sparkCursor = (this.sparkCursor + 1) % this.sparks.length;
      const a = Math.random() * Math.PI * 2, r = SHAFT_R - 1;
      p.mesh.position.set(Math.cos(a) * r * Math.random(), Math.sin(a) * r * Math.random(), this.z + 7);
      p.vx = Math.cos(a) * (4 + Math.random() * 8); p.vy = Math.sin(a) * (4 + Math.random() * 8);
      p.vz = 2 + Math.random() * 6; p.life = 1;
      p.mesh.material.color.copy(col); p.mesh.material.opacity = 1;
      p.mesh.scale.setScalar(0.5 + Math.random() * 0.8); p.mesh.visible = true;
    }
  }
  _updateSparks(dt) {
    for (const p of this.sparks) {
      if (p.life <= 0) continue;
      p.life -= dt * 2;
      p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
      p.mesh.quaternion.copy(this.camera.quaternion);
      p.mesh.material.opacity = Math.max(0, p.life);
      if (p.life <= 0) p.mesh.visible = false;
    }
  }

  _shake(a) { this.shakeAmt = Math.min(2, this.shakeAmt + a); }

  _finish() {
    this.running = false;
    const isBest = this.score >= this.best && this.score > 0;
    this.hud.showResult(this.score, this.best, isBest);
  }

  _loadBest() { try { return +localStorage.getItem('flux.best') || 0; } catch { return 0; } }
  _saveBest(v) { try { localStorage.setItem('flux.best', String(v)); } catch {} }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(w, h);
  }
}

// ---- procedural textures ---------------------------------------------------
function makeTunnelTexture() {
  const s = 128; const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  g.fillStyle = '#070a16'; g.fillRect(0, 0, s, s);
  // faint vertical ribs + glowing seams for a sense of speed
  g.strokeStyle = 'rgba(70,110,200,0.25)'; g.lineWidth = 2;
  for (let x = 0; x < s; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.stroke(); }
  g.strokeStyle = 'rgba(90,150,255,0.5)'; g.shadowColor = 'rgba(90,150,255,0.8)'; g.shadowBlur = 6;
  g.beginPath(); g.moveTo(0, 2); g.lineTo(s, 2); g.stroke();
  return new THREE.CanvasTexture(cv);
}

function makePuff() {
  const s = 64; const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}
