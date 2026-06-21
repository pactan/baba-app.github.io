import * as THREE from 'three';
import { Ragdoll } from './physics.js?v=20';
// Bloom is loaded dynamically below so a missing addon can't block startup.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

const MIN_POWER = 24, MAX_POWER = 80;   // arrow launch speed range (charge maps here)
const CHARGE_RATE = 1.1;                // how fast hold fills the power bar (per s)
const GRAV_ARROW = -14;                 // arrow gravity (slight drop => skill)

// --- 3 example levels: a target ragdoll + scenery + a goal ------------------
// goal kinds: 'ko' = knock it out, 'topple' = knock its CoM off a ledge.
const LEVELS = [
  { name: 'RANGE',  goal: 'ko',     spawn: [0, 0, 0], ground: 'flat',  scenery: 'range' },
  { name: 'LEDGE',  goal: 'topple', spawn: [0, 3.0, 0], ground: 'ledge', scenery: 'ledge' },
  { name: 'CANYON', goal: 'ko',     spawn: [0, 0, 0], ground: 'hill',  scenery: 'canyon' },
];

export class Game {
  constructor(canvas, audio, input, hud) {
    this.audio = audio; this.input = input; this.hud = hud;
    this.onError = null;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x9fb6d8, 40, 140);
    this.scene.background = new THREE.Color(0x9fb6d8);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
    this.camPos = new THREE.Vector3(0, 1.7, 9);     // POV the arrows launch from

    this._lights();
    this._sky();
    this.env = this._makeEnv();
    this.ragdoll = new Ragdoll();
    this._buildRagdollMesh();
    this._arrows();
    this._fx();
    this._post();

    this.best = this._loadBest();
    this.levelIdx = 0;
    this._reset();
    this.running = false;
    this.hud.setBest(this.best);

    this.clock = new THREE.Clock();
    addEventListener('resize', () => this._resize());
    this._resize();
  }

  _lights() {
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x4a5240, 0.85));
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.0);
    sun.position.set(-8, 18, 6); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 18; Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 60 });
    sun.shadow.bias = -0.0004; sun.shadow.radius = 5;
    this.scene.add(sun); this.scene.add(sun.target); this.sun = sun;
  }

  _sky() {
    const geo = new THREE.SphereGeometry(300, 32, 16);
    const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x3f6fb8) }, bot: { value: new THREE.Color(0xbcd0e8) } },
      vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 bot;
        void main(){ float h=normalize(vP).y*0.5+0.5; gl_FragColor=vec4(mix(bot,top,smoothstep(0.0,1.0,h)),1.0);}` });
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  // env exposes groundY(x,z) + boxes[] for the physics; scenery meshes are built
  // per level in _loadLevel.
  _makeEnv() {
    return {
      kind: 'flat', boxes: [],
      groundY(x, z) {
        if (this.kind === 'flat' || this.kind === 'range') return 0;
        if (this.kind === 'ledge') return (z < -1.2) ? -8 : 3;       // a raised platform you knock it off
        if (this.kind === 'hill') return Math.max(0, -1.4 + Math.cos(x * 0.18) * 1.2 + 1.4) * 0.0 + (x * 0.0) + slope(x, z);
        return 0;
      },
    };
    function slope(x, z) { return clamp(2.0 - (z + 6) * 0.0 - Math.abs(x) * 0.18, -2, 2) * 0.0 + Math.max(0, 1.5 - Math.hypot(x, z + 2) * 0.12); }
  }

  // a simple capsule-ish humanoid skin: a sphere per joint + a tube per bone,
  // all driven by the physics particle positions each frame.
  _buildRagdollMesh() {
    this.skin = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xb9c4ff, roughness: 0.45, metalness: 0.05 });
    this.jointMeshes = {};
    for (const p of this.ragdoll.P) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(p.r * 1.25, 14, 12), mat);
      m.castShadow = true; this.skin.add(m); this.jointMeshes[p.name] = m;
    }
    // head gets eyes for character (matches the reference figure)
    const head = this.jointMeshes['head'];
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a2233, roughness: 0.4 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), eyeMat);
      eye.position.set(sx * 0.06, 0.03, 0.14); head.add(eye);
    }
    this.boneMeshes = this.ragdoll.bones.map(() => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 8), mat);
      m.castShadow = true; this.skin.add(m); return m;
    });
    this.scene.add(this.skin);
    this._up = new THREE.Vector3(0, 1, 0);
  }

  _arrows() {
    this.arrows = [];
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.6 });
    const tipMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.6, roughness: 0.3 });
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 6), shaftMat);
      shaft.rotation.x = Math.PI / 2; g.add(shaft);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), tipMat);
      tip.rotation.x = Math.PI / 2; tip.position.z = 0.58; g.add(tip);
      g.visible = false; g.castShadow = true; this.scene.add(g);
      this.arrows.push({ grp: g, vel: new THREE.Vector3(), pos: new THREE.Vector3(), live: false, stuck: null, stuckOff: new THREE.Vector3() });
    }
    this.arrowCursor = 0;
  }

  _fx() {
    const tex = makePuff();
    this.fx = [];
    for (let i = 0; i < 30; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; this.scene.add(m);
      this.fx.push({ mesh: m, life: 0, v: new THREE.Vector3() });
    }
    this.fxCursor = 0;
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
      c.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.6, 0.9));
      c.setSize(innerWidth, innerHeight);
      this.composer = c;
    } catch (e) { this.composer = null; }
  }

  // ---------------------------------------------------------------- levels --
  _loadLevel(idx) {
    if (this.sceneryGroup) { this.scene.remove(this.sceneryGroup); }
    this.sceneryGroup = new THREE.Group(); this.scene.add(this.sceneryGroup);
    const L = LEVELS[idx];
    this.env.kind = L.ground; this.env.boxes = [];

    const groundMat = new THREE.MeshStandardMaterial({ color: 0x6b7d52, roughness: 0.95 });
    if (L.ground === 'flat' || L.ground === 'range') {
      const g = new THREE.Mesh(new THREE.BoxGeometry(60, 1, 60), groundMat);
      g.position.y = -0.5; g.receiveShadow = true; this.sceneryGroup.add(g);
    } else if (L.ground === 'ledge') {
      const plat = new THREE.Mesh(new THREE.BoxGeometry(20, 6, 8), new THREE.MeshStandardMaterial({ color: 0x7a6b52, roughness: 0.9 }));
      plat.position.set(0, 0, 2); plat.receiveShadow = true; plat.castShadow = true; this.sceneryGroup.add(plat);
      const low = new THREE.Mesh(new THREE.BoxGeometry(60, 1, 60), groundMat);
      low.position.set(0, -8.5, 0); low.receiveShadow = true; this.sceneryGroup.add(low);
    } else {
      const g = new THREE.Mesh(new THREE.BoxGeometry(60, 1, 60), groundMat);
      g.position.y = -0.5; g.receiveShadow = true; this.sceneryGroup.add(g);
      const hill = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 16), groundMat);
      hill.position.set(0, -4.5, -2); hill.scale.y = 0.5; hill.receiveShadow = true; this.sceneryGroup.add(hill);
    }
    // decorative target rings behind the figure (range vibe)
    if (L.scenery === 'range') {
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1 - i * 0.32, 0.12, 8, 24),
          new THREE.MeshStandardMaterial({ color: i % 2 ? 0xff5566 : 0xf5f5f5, roughness: 0.5 }));
        ring.position.set(0, 1.4, -3.2); this.sceneryGroup.add(ring);
      }
    }
    this.goal = L.goal; this.spawn = new THREE.Vector3(...L.spawn);
    this.hud.setLevel(idx + 1, LEVELS.length, L.name);
  }

  // ---------------------------------------------------------------- state --
  _reset() {
    this._loadLevel(this.levelIdx);
    this.ragdoll.reset(this.spawn);
    this.shots = 0; this.won = false; this.over = false; this.overT = 0; this._shownResult = false;
    this.power = 0; this.charging = false;
    this.reticle = new THREE.Vector2(0, 0);     // -1..1 screen aim
    this.shakeAmt = 0; this.settle = 0;
    for (const a of this.arrows) { a.live = false; a.grp.visible = false; a.stuck = null; }
    for (const f of this.fx) { f.life = 0; f.mesh.visible = false; }
    this.hud.setShots(0); this.hud.setPower(0); this.hud.hideResult(); this.hud.setGoal(this.goal);
  }

  start() { this._reset(); this.running = true; this.clock.getDelta(); this._loop(); }
  restart() { this._reset(); this.running = true; }
  nextLevel() { this.levelIdx = (this.levelIdx + 1) % LEVELS.length; this._reset(); this.running = true; }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 1 / 60);
    try {
      if (this.running) this._update(dt);
      this._render(dt);
      if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    } catch (e) { this.running = false; if (this.onError) this.onError(e); }
  }

  _update(dt) {
    // aim reticle from joystick
    this.reticle.x = clamp(this.reticle.x + this.input.aim.x * dt * 1.7, -1, 1);
    this.reticle.y = clamp(this.reticle.y - this.input.aim.y * dt * 1.7, -1, 1);

    // charge / fire
    if (this.input.charging && !this.over) {
      this.charging = true; this.power = clamp(this.power + CHARGE_RATE * dt, 0, 1);
      this.audio.draw(this.power);
    }
    if (this.input.fired && !this.over) { this.input.endFrame(); this._fire(); }
    else this.input.endFrame();
    this.hud.setPower(this.power);

    // step physics (a couple of substeps for stability)
    for (let s = 0; s < 2; s++) this.ragdoll.step(dt / 2, this.env);

    this._stepArrows(dt);
    this._stepFx(dt);

    // win detection
    if (!this.won && !this.over) this._checkGoal(dt);
    if (this.over) { this.overT += dt; if (this.overT > 1.2 && !this._shownResult) { this._shownResult = true; this._finish(); } }
  }

  _fire() {
    if (this.power < 0.04) { this.power = 0; return; }
    const a = this.arrows[this.arrowCursor]; this.arrowCursor = (this.arrowCursor + 1) % this.arrows.length;
    // aim: reticle maps to a yaw/pitch from the POV toward the scene
    const yaw = this.reticle.x * 0.5;
    const pitch = -this.reticle.y * 0.5 + 0.04;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).normalize();
    const speed = lerp(MIN_POWER, MAX_POWER, this.power);
    a.pos.copy(this.camPos);
    a.vel.copy(dir).multiplyScalar(speed);
    a.live = true; a.stuck = null; a.grp.visible = true;
    this.audio.release(this.power);
    this.shots++; this.hud.setShots(this.shots);
    this.power = 0; this.charging = false;
  }

  _stepArrows(dt) {
    for (const a of this.arrows) {
      if (!a.live) continue;
      if (a.stuck) {
        // follow the joint it stuck into
        a.grp.position.copy(a.stuck.pos).add(a.stuckOff);
        continue;
      }
      a.vel.y += GRAV_ARROW * dt;
      const step = a.vel.clone().multiplyScalar(dt);
      const next = a.pos.clone().add(step);

      // hit test vs ragdoll joints (segment-sphere)
      let hit = null, hitT = 1;
      for (const p of this.ragdoll.P) {
        const t = segSphere(a.pos, next, p.pos, p.r * 1.3);
        if (t >= 0 && t < hitT) { hitT = t; hit = p; }
      }
      if (hit) {
        const point = a.pos.clone().lerp(next, hitT);
        const dir = a.vel.clone().normalize();
        const info = this.ragdoll.hit(point, dir, a.vel.length());
        a.pos.copy(point); a.stuck = info.joint; a.stuckOff.copy(point).sub(info.joint.pos);
        this._impact(info, point);
      } else if (next.y <= this.env.groundY(next.x, next.z)) {
        a.live = false; a.grp.visible = false;     // hit ground, despawn
      } else {
        a.pos.copy(next);
        // orient arrow along velocity
        a.grp.position.copy(a.pos);
        a.grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), a.vel.clone().normalize());
      }
      // cull far misses
      if (a.pos.length() > 120) { a.live = false; a.grp.visible = false; }
    }
  }

  _impact(info, point) {
    this._burst(point, info.group === 'head' ? 0xff4466 : 0xffd27a, info.group === 'head' ? 14 : 8);
    this._shake(info.group === 'head' ? 0.5 : 0.25);
    if (info.group === 'head') { this.audio.hitHead(); this.audio.ko(); this.hud.flash('HEADSHOT — K.O.!'); }
    else if (info.group === 'chest') { this.audio.hitBody(this.power); this.hud.flash('CHEST — staggered'); }
    else { this.audio.hitBody(this.power); }
  }

  _checkGoal(dt) {
    if (this.goal === 'ko') {
      if (this.ragdoll.knockedOut) { this.settle += dt; if (this.settle > 0.6) this._win(); }
      else this.settle = 0;
    } else if (this.goal === 'topple') {
      const com = this.ragdoll.com();
      // knocked off the ledge platform (fell below it)
      if (com.y < 1.0) { this.settle += dt; if (this.settle > 0.4) this._win(); }
      else this.settle = 0;
    }
  }

  _win() {
    if (this.won) return; this.won = true; this.over = true; this.overT = 0;
    this.audio.win();
    const score = Math.max(1, 50 - (this.shots - 1) * 6);   // fewer arrows = better
    this.lastScore = score;
    if (score > this.best) { this.best = score; this._saveBest(this.best); this.hud.setBest(this.best); }
  }

  _finish() {
    this.running = false;
    this.hud.showResult(this.lastScore || 0, this.best, (this.lastScore || 0) >= this.best, this.shots, this.levelIdx + 1, LEVELS.length);
  }

  // ---------------------------------------------------------------- render --
  _render(dt) {
    // drive the skin from physics particles
    for (const p of this.ragdoll.P) this.jointMeshes[p.name].position.copy(p.pos);
    for (let i = 0; i < this.ragdoll.bones.length; i++) {
      const c = this.ragdoll.bones[i], m = this.boneMeshes[i];
      const a = c.a.pos, b = c.b.pos;
      m.position.copy(a).add(b).multiplyScalar(0.5);
      const d = b.clone().sub(a); const len = d.length();
      m.scale.set(1, Math.max(0.01, len), 1);
      m.quaternion.setFromUnitVectors(this._up, d.normalize());
    }
    // tint the whole skin toward grey as it loses consciousness (visual KO read)
    const c01 = this.ragdoll.consciousness;
    const col = this.jointMeshes['head'].material.color;
    col.setRGB(lerp(0.55, 0.72, c01), lerp(0.55, 0.77, c01), lerp(0.6, 1.0, c01));

    this._stepFxRender();

    // camera: a gentle handheld POV with shake; looks toward the figure
    const sh = this.shakeAmt; this.shakeAmt *= Math.pow(0.0001, dt);
    const com = this.ragdoll.com();
    const look = new THREE.Vector3(com.x * 0.4 + this.reticle.x * 2.4, 1.4 + this.reticle.y * 1.6 + com.y * 0.1, com.z - 3);
    this.camera.position.copy(this.camPos);
    this.camera.position.x += (Math.random() - 0.5) * sh; this.camera.position.y += (Math.random() - 0.5) * sh;
    this.camera.lookAt(look);

    // HUD reticle position (screen-space) — project the aim direction
    this.hud.setReticle((this.reticle.x * 0.5 + 0.5), (this.reticle.y * 0.5 + 0.5));
  }

  _burst(pos, color, n) {
    const col = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const f = this.fx[this.fxCursor]; this.fxCursor = (this.fxCursor + 1) % this.fx.length;
      f.mesh.position.copy(pos);
      f.v.set((Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6);
      f.life = 1; f.mesh.material.color.copy(col); f.mesh.material.opacity = 1;
      f.mesh.scale.setScalar(0.2 + Math.random() * 0.4); f.mesh.visible = true;
    }
  }
  _stepFx(dt) {
    for (const f of this.fx) { if (f.life <= 0) continue; f.life -= dt * 2.2; f.v.y -= 12 * dt; f.mesh.position.addScaledVector(f.v, dt); }
  }
  _stepFxRender() {
    for (const f of this.fx) {
      if (f.life <= 0) { if (f.mesh.visible) f.mesh.visible = false; continue; }
      f.mesh.quaternion.copy(this.camera.quaternion);
      f.mesh.material.opacity = Math.max(0, f.life);
    }
  }

  _shake(a) { this.shakeAmt = Math.min(1.2, this.shakeAmt + a); }

  _loadBest() { try { return +localStorage.getItem('archery.best') || 0; } catch { return 0; } }
  _saveBest(v) { try { localStorage.setItem('archery.best', String(v)); } catch {} }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(w, h);
  }
}

// segment (a->b) vs sphere (c,r): returns t in [0,1] of first hit, or -1
function segSphere(a, b, c, r) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const fx = a.x - c.x, fy = a.y - c.y, fz = a.z - c.z;
  const A = dx * dx + dy * dy + dz * dz;
  const B = 2 * (fx * dx + fy * dy + fz * dz);
  const C = fx * fx + fy * fy + fz * fz - r * r;
  let disc = B * B - 4 * A * C;
  if (disc < 0 || A < 1e-9) return -1;
  disc = Math.sqrt(disc);
  const t = (-B - disc) / (2 * A);
  if (t >= 0 && t <= 1) return t;
  const t2 = (-B + disc) / (2 * A);
  if (t2 >= 0 && t2 <= 1) return 0;   // already inside
  return -1;
}

function makePuff() {
  const s = 64; const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}
