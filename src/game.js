import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
// Bloom is loaded dynamically below so a missing addon can't block startup.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// --- tuning (cohesive but arcade) ------------------------------------------
const ACCEL = 30;          // throttle acceleration
const BRAKE = 42;          // braking deceleration
const REV_MAX = 11;        // max reverse speed
const MAX_SPD = 40;        // top speed
const DRAG = 0.55;         // coast-down drag
const TURN = 2.5;          // max steering yaw rate (rad/s)
const TURN_REF = 12;       // speed for full steering authority
const GRIP_LO = 7.5;       // lateral grip at low speed (tight, no parking drifts)
const GRIP_HI = 1.9;       // lateral grip at top speed (slides — the drift)
const GRAVITY = 50;
const JUMP_V = 16;

// rollover: sustained lateral G while gripping tips the cube over.
// Drifting *releases* lateral force, so sliding is the safe way to corner fast.
const TIP_G = 88;          // lateral accel threshold (vFwd * yawRate)
const TIP_TIME = 0.3;      // must stay above threshold this long (warning lean)
const TUMBLE_DUR = 1.15;   // how long a tumble lasts

const HALF = 140;          // map half-size (280 x 280 — one big map)
const CUBE = 2.2;
const CAM_BACK = 14, CAM_H = 9.5;

// seeded PRNG so the single map is always the same map
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export class Game {
  constructor(canvas, audio, input, hud) {
    this.audio = audio; this.input = input; this.hud = hud;
    this.onError = null;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0a0e1c, 70, 200);
    this._sky();

    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const env = new RoomEnvironment();
      this.scene.environment = pmrem.fromScene(env, 0.04).texture;
      env.dispose();
    } catch (e) {}

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
    this.camPos = new THREE.Vector3(0, CAM_H, -CAM_BACK);
    this.camLook = new THREE.Vector3();
    this.camYaw = 0;

    this._lights();
    this._world();
    this._cube();
    this._skids();
    this._smoke();
    this._debris();
    this._post();

    this.best = this._loadBest();
    this._reset();
    this.running = false;
    this.hud.setBest(this.best);

    this.clock = new THREE.Clock();
    addEventListener('resize', () => this._resize());
    this._resize();
  }

  // ---------------------------------------------------------------- scene --
  _sky() {
    const geo = new THREE.SphereGeometry(360, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x0a1230) }, bot: { value: new THREE.Color(0x2a1840) },
        glow: { value: new THREE.Color(0x4a2a6a) } },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);}`,
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 bot; uniform vec3 glow;
        void main(){ float h = normalize(vP).y*0.5+0.5; vec3 c = mix(bot, top, smoothstep(0.0,1.0,h));
        c += glow * pow(1.0-abs(normalize(vP).y), 6.0)*0.6; gl_FragColor = vec4(c,1.0);}`,
    });
    this.scene.add(new THREE.Mesh(geo, mat));
    for (const [x, y, z, c, r] of [[-160, 90, -220, 0x6ad0ff, 18], [200, 120, -160, 0xff7ad0, 11]]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshBasicMaterial({ color: c }));
      m.position.set(x, y, z); this.scene.add(m);
    }
  }

  _lights() {
    this.scene.add(new THREE.HemisphereLight(0x8aa0ff, 0x0a0c16, 0.5));
    const sun = new THREE.DirectionalLight(0xfff2e0, 1.9);
    sun.position.set(10, 26, 8); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 100;
    const d = 42; Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
    sun.shadow.bias = -0.0004; sun.shadow.radius = 4;
    this.scene.add(sun); this.scene.add(sun.target);
    this.sun = sun;
  }

  _world() {
    // dark asphalt with a faint neon grid (proven not to white-out under bloom)
    const tex = makeFloorTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(46, 46);
    tex.anisotropy = 8;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF * 2 + 140, HALF * 2 + 140),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.72, metalness: 0.08 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);

    // neon boundary walls
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x05122a, roughness: 0.3, metalness: 0.4, emissive: 0x2a9dff, emissiveIntensity: 2.0 });
    for (const s of [-1, 1]) {
      const wx = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 1, 2.2, 0.8), wallMat);
      wx.position.set(0, 1.1, s * HALF); wx.castShadow = wx.receiveShadow = true; this.scene.add(wx);
      const wz = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.2, HALF * 2 + 1), wallMat);
      wz.position.set(s * HALF, 1.1, 0); wz.castShadow = wz.receiveShadow = true; this.scene.add(wz);
    }

    this._fixedObstacles();
    this._movableObstacles();
  }

  // immovable: glowing blocks + pillars, placed by a fixed seed (one true map)
  _fixedObstacles() {
    this.fixed = [];
    const rnd = mulberry32(1337);
    const blockMat = new THREE.MeshStandardMaterial({ color: 0x141a2a, roughness: 0.4, metalness: 0.3, emissive: 0x2a9dff, emissiveIntensity: 1.2 });
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x0a0e18, roughness: 0.3, metalness: 0.4, emissive: 0xff2a6d, emissiveIntensity: 1.5 });
    for (let k = 0; k < 16; k++) {
      const x = (rnd() * 2 - 1) * (HALF - 18);
      const z = (rnd() * 2 - 1) * (HALF - 18);
      if (Math.hypot(x - 0, z - (-HALF + 24)) < 30) continue;  // keep spawn clear
      if (k % 3 === 2) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 7, 16), pillarMat);
        m.position.set(x, 3.5, z); m.castShadow = true; this.scene.add(m);
        this.fixed.push({ x, z, r: 2.4, h: 7 });
      } else {
        const w = 5 + rnd() * 6, d = 5 + rnd() * 6, h = 3.5 + rnd() * 3.5;
        const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, 0.2), blockMat);
        m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true; this.scene.add(m);
        this.fixed.push({ x, z, r: Math.max(w, d) * 0.5 + 0.6, h });
      }
    }
  }

  // movable: crates, barrels, cones — get knocked flying when hit
  _movableObstacles() {
    this.movables = [];
    const rnd = mulberry32(4242);
    const crateMat = new THREE.MeshStandardMaterial({ map: makeWoodTexture('#7a5a30', '#5e441f'), roughness: 0.7 });
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x2255cc, roughness: 0.35, metalness: 0.5, emissive: 0x113077, emissiveIntensity: 0.5 });
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.55, emissive: 0x5a2400, emissiveIntensity: 0.5 });
    for (let k = 0; k < 30; k++) {
      const x = (rnd() * 2 - 1) * (HALF - 12);
      const z = (rnd() * 2 - 1) * (HALF - 12);
      if (Math.hypot(x - 0, z - (-HALF + 24)) < 22) continue;  // keep spawn clear
      let mesh, r, h;
      const kind = k % 3;
      if (kind === 0) { mesh = new THREE.Mesh(new RoundedBoxGeometry(2.2, 2.2, 2.2, 3, 0.14), crateMat); mesh.position.set(x, 1.1, z); r = 1.6; h = 2.2; }
      else if (kind === 1) { mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.4, 14), barrelMat); mesh.position.set(x, 1.2, z); r = 1.3; h = 2.4; }
      else { mesh = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.7, 14), coneMat); mesh.position.set(x, 0.85, z); r = 1.0; h = 1.7; }
      mesh.rotation.y = rnd() * 6;
      mesh.castShadow = true; this.scene.add(mesh);
      this.movables.push({ mesh, x, z, r, h, vx: 0, vz: 0, vy: 0, spin: 0, knocked: false });
    }
  }

  _cube() {
    this.cube = new THREE.Group();
    this.cube.rotation.order = 'YXZ';
    this.woodMat = new THREE.MeshStandardMaterial({ map: makeWoodTexture(), roughness: 0.65, metalness: 0.0 });
    const box = new THREE.Mesh(new RoundedBoxGeometry(CUBE, CUBE, CUBE, 5, 0.16), this.woodMat);
    box.castShadow = true; box.position.y = CUBE / 2; this.cube.add(box);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(CUBE, CUBE, CUBE)),
      new THREE.LineBasicMaterial({ color: 0x2a1c0e }));
    edges.position.y = CUBE / 2; this.cube.add(edges);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(CUBE * 0.5, 0.14, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x120c06, roughness: 0.6 }));
    nose.position.set(0, CUBE * 0.5, CUBE * 0.5 + 0.01); this.cube.add(nose);
    this.scene.add(this.cube);

    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(CUBE * 1.7, CUBE * 1.7),
      new THREE.MeshBasicMaterial({ map: makePuff(0.7), color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2; this.scene.add(this.blob);
  }

  _skids() {
    const geo = new THREE.PlaneGeometry(0.5, 1.6);
    this.skids = [];
    for (let i = 0; i < 200; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x0a0705, transparent: true, opacity: 0, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.visible = false; this.scene.add(m);
      this.skids.push({ mesh: m, life: 0 });
    }
    this.skidCursor = 0; this.skidTimer = 0;
  }

  _smoke() {
    const tex = makePuff(0.8);
    this.smoke = [];
    for (let i = 0; i < 64; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: tex, color: 0x999999, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; this.scene.add(m);
      this.smoke.push({ mesh: m, life: 0, vx: 0, vy: 0, vz: 0, size: 1 });
    }
    this.smokeCursor = 0; this.dustTimer = 0; this.driftSmokeTimer = 0;
  }

  _debris() {
    this.debris = [];
    for (let i = 0; i < 36; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
      m.visible = false; this.scene.add(m);
      this.debris.push({ mesh: m, life: 0, vx: 0, vy: 0, vz: 0 });
    }
    this.debrisCursor = 0;
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
      c.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.6, 0.85));
      c.setSize(innerWidth, innerHeight);
      this.composer = c;
    } catch (e) { this.composer = null; }
  }

  // ---------------------------------------------------------------- state --
  _reset() {
    this.pos = new THREE.Vector3(0, 0, -HALF + 24);
    this.theta = 0;
    this.vel = new THREE.Vector2(0, 0);
    this.vy = 0; this.airborne = false;
    this.score = 0;
    this.pending = 0; this.driftTime = 0; this.mult = 1; this.notDrift = 0;
    this.tipTimer = 0;
    this.tumbling = false; this.tumbleT = 0; this.tumbleAxis = 'z'; this.tumbleDir = 1;
    this.camYaw = 0; this.shakeAmt = 0;
    this.hud.setScore(0);
  }

  start() { this._reset(); this.running = true; this.clock.getDelta(); this._loop(); }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 1 / 30);
    try {
      if (this.running) this._update(dt);
      if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    } catch (e) { this.running = false; if (this.onError) this.onError(e); }
  }

  // --------------------------------------------------------------- update --
  _update(dt) {
    if (this.tumbling) return this._updateTumble(dt);

    const steer = this.input.steer;
    const gas = this.input.gas, brake = this.input.brake;

    // jump (grounded only)
    if (this.input.jump && !this.airborne) { this.vy = JUMP_V; this.airborne = true; this.audio.jump(); }
    this.input.endFrame();

    // steering first: rotate the heading, then split the OLD velocity in the
    // NEW frame — the heading change leaves the velocity behind, and that lag
    // IS the lateral slip that grip then fights (or doesn't => drift).
    const fwd0 = this.vel.x * Math.sin(this.theta) + this.vel.y * Math.cos(this.theta);
    const authority = clamp(Math.abs(fwd0) / TURN_REF, 0, 1) * (this.airborne ? 0.35 : 1);
    const yawRate = steer * TURN * authority * (fwd0 >= 0 ? 1 : -1);
    this.theta += yawRate * dt;

    const sn = Math.sin(this.theta), cs = Math.cos(this.theta);
    let vFwd = this.vel.x * sn + this.vel.y * cs;
    let vLat = this.vel.x * cs - this.vel.y * sn;

    // throttle / brake / reverse / drag
    if (gas) vFwd += ACCEL * dt;
    if (brake) vFwd -= (vFwd > 0.5 ? BRAKE : ACCEL * 0.7) * dt;   // brake, then slow reverse
    vFwd -= vFwd * DRAG * dt;
    vFwd = clamp(vFwd, -REV_MAX, MAX_SPD);

    const speed01 = clamp(Math.abs(vFwd) / MAX_SPD, 0, 1);

    // lateral grip: tight at low speed, loose at high speed => natural drift
    const grip = this.airborne ? 0.2 : lerp(GRIP_LO, GRIP_HI, speed01);
    vLat -= vLat * clamp(grip * dt, 0, 1);

    // drift measure from slip angle
    const slipDeg = Math.abs(Math.atan2(vLat, Math.max(Math.abs(vFwd), 0.5))) * 180 / Math.PI;
    const drifting = !this.airborne && Math.abs(vFwd) > 8 && slipDeg > 8;
    const driftAmt = drifting ? clamp((slipDeg - 8) / 32, 0, 1) : 0;

    // --- rollover from inertia: full-lock steering near top speed flips you.
    // Feather the steering or brake before hard corners — or you roll.
    const latG = Math.abs(vFwd * yawRate);
    if (!this.airborne && latG > TIP_G) {
      this.tipTimer += dt;
      if (this.tipTimer > TIP_TIME) return this._startTumble('z', steer >= 0 ? -1 : 1);
    } else this.tipTimer = Math.max(0, this.tipTimer - dt * 2);

    // recompose (same frame) + integrate
    this.vel.set(vFwd * sn + vLat * cs, vFwd * cs - vLat * sn);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;

    // walls
    for (const ax of ['x', 'z']) {
      const v = ax === 'x' ? 'x' : 'y';
      if (this.pos[ax] > HALF - 1.4) { this.pos[ax] = HALF - 1.4; this._wallHit(v); }
      if (this.pos[ax] < -(HALF - 1.4)) { this.pos[ax] = -(HALF - 1.4); this._wallHit(v); }
    }

    // vertical
    if (this.airborne) {
      this.vy -= GRAVITY * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) { this.pos.y = 0; this.vy = 0; this.airborne = false; this.audio.land(); this._shake(0.15); }
    }

    this._collideFixed();
    this._collideMovables();
    if (this.tumbling) return;   // a collision may have started a tumble

    // --- drift scoring (combo banks when you straighten) ---
    if (drifting) {
      this.driftTime += dt; this.notDrift = 0;
      this.mult = clamp(1 + Math.floor(this.driftTime / 1.2), 1, 9);
      this.pending += Math.abs(vFwd) * driftAmt * dt * 5;
      this.hud.setCombo(this.mult, Math.floor(this.pending * this.mult), true);
    } else if (this.pending > 0) {
      this.notDrift += dt; if (this.notDrift > 0.45) this._bank();
    }

    // --- friction dust (always when rolling) + drift smoke (more with speed) --
    if (!this.airborne && Math.abs(vFwd) > 4) {
      this.dustTimer += dt;
      if (this.dustTimer > lerp(0.12, 0.05, speed01)) { this.dustTimer = 0; this._emitSmoke(0.10 + speed01 * 0.06, 0.7, 0x777777); }
    }
    if (driftAmt > 0.15) {
      this.driftSmokeTimer += dt;
      const rate = lerp(0.05, 0.018, speed01);      // faster = denser smoke
      if (this.driftSmokeTimer > rate) {
        this.driftSmokeTimer = 0;
        const o = driftAmt * (0.35 + speed01 * 0.45); // faster = thicker smoke
        this._emitSmoke(o, 1.1 + speed01 * 0.7, 0xbbbbbb);
        this._emitSmoke(o * 0.8, 0.9 + speed01 * 0.5, 0xa9a9a9);
      }
      this.skidTimer += dt;
      if (this.skidTimer > 0.022) { this.skidTimer = 0; this._dropSkid(); }
    }
    this._updateSmoke(dt); this._fadeSkids(dt); this._updateDebris(dt); this._updateMovables(dt);

    // --- place cube: lean into the slide, wobble near tip threshold ---
    this.cube.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.cube.rotation.y = this.theta;
    const tipWarn = clamp(this.tipTimer / TIP_TIME, 0, 1);
    const leanZ = clamp(-vLat * 0.045, -0.35, 0.35) - steer * tipWarn * 0.25;
    this.cube.rotation.z = lerp(this.cube.rotation.z, leanZ, Math.min(1, dt * 10));
    this.cube.rotation.x = lerp(this.cube.rotation.x, this.airborne ? -0.15 : (gas ? -0.03 : brake ? 0.05 : 0), Math.min(1, dt * 8));
    this.blob.position.set(this.pos.x, 0.05, this.pos.z);
    const air = clamp(1 - this.pos.y / 6, 0.25, 1);
    this.blob.scale.setScalar(air); this.blob.material.opacity = 0.45 * air;

    this._updateCamera(dt, speed01, driftAmt);

    this.audio.engine(speed01, gas);
    this.audio.screech(driftAmt * clamp(Math.abs(vFwd) / 12, 0, 1));

    if (this.score > this.best) { this.best = this.score; this._saveBest(this.best); this.hud.setBest(this.best); }
    this.hud.setScore(this.score);
  }

  // tumble: the cube physically rolls over — control lost, speed bleeds off
  _startTumble(axis, dir) {
    this.tumbling = true; this.tumbleT = 0; this.tumbleAxis = axis; this.tumbleDir = dir;
    if (this.pending > 0) { this.pending = 0; this.mult = 1; this.driftTime = 0; this.hud.setCombo(1, 0, false); } // combo lost!
    this.audio.tumble(); this.audio.screech(0);
    this._shake(1.3);
  }

  _updateTumble(dt) {
    this.tumbleT += dt;
    const k = this.tumbleT / TUMBLE_DUR;
    // velocity bleeds off fast while rolling
    this.vel.multiplyScalar(Math.pow(0.12, dt));
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.y * dt;
    // little hop + two full body rolls
    this.pos.y = Math.max(0, Math.sin(Math.min(k, 1) * Math.PI) * 1.4);
    const roll = this.tumbleDir * (k * Math.PI * 2 * 2);
    this.cube.position.set(this.pos.x, this.pos.y, this.pos.z);
    if (this.tumbleAxis === 'z') this.cube.rotation.z = roll; else this.cube.rotation.x = roll;
    // dust burst while rolling
    if (Math.random() < 0.5) this._emitSmoke(0.3, 1.0, 0x8a8a8a);
    this._updateSmoke(dt); this._fadeSkids(dt); this._updateDebris(dt); this._updateMovables(dt);
    this.blob.position.set(this.pos.x, 0.05, this.pos.z);
    this._updateCamera(dt, 0.2, 0);
    this.audio.engine(0.15, false);
    if (this.tumbleT >= TUMBLE_DUR) {
      this.tumbling = false;
      this.cube.rotation.x = 0; this.cube.rotation.z = 0;
      this.pos.y = 0; this.airborne = false; this.vy = 0;
      this.tipTimer = 0;
      this.audio.land();
    }
  }

  _wallHit(velKey) {
    const impact = Math.abs(this.vel[velKey]);
    this.vel[velKey] *= -0.45;
    if (impact > 8) { this.audio.thud(); this._shake(clamp(impact * 0.04, 0.2, 1)); }
  }

  _collideFixed() {
    for (const b of this.fixed) {
      const dx = this.pos.x - b.x, dz = this.pos.z - b.z;
      const d = Math.hypot(dx, dz), min = b.r + 1.2;
      if (d >= min || d < 1e-4) continue;
      if (this.pos.y > b.h) continue;                  // sailed clean over it
      const nx = dx / d, nz = dz / d;
      this.pos.x = b.x + nx * min; this.pos.z = b.z + nz * min;
      const vdot = this.vel.x * nx + this.vel.y * nz;
      let impact = 0;
      if (vdot < 0) { impact = -vdot; this.vel.x -= 1.6 * vdot * nx; this.vel.y -= 1.6 * vdot * nz; }
      // airborne smack or a hard frontal hit flips you end over end
      if (this.airborne || impact > 26) { this._burstDebris(b.x, b.z, 0x4a78c0, 4); return this._startTumble('x', -1); }
      if (impact > 6) { this.audio.thud(); this._shake(clamp(impact * 0.045, 0.2, 1.1)); }
    }
  }

  _collideMovables() {
    const speed = this.vel.length();
    for (const o of this.movables) {
      const dx = o.mesh.position.x - this.pos.x, dz = o.mesh.position.z - this.pos.z;
      const d = Math.hypot(dx, dz), min = o.r + 1.4;
      if (d >= min || d < 1e-4) continue;
      if (this.pos.y > o.h) continue;                  // jumped over it
      const nx = dx / d, nz = dz / d;
      // hitting a solid object while airborne sends you tumbling
      if (this.airborne) {
        o.vx = nx * 14; o.vz = nz * 14; o.vy = 7; o.spin = (Math.random() - 0.5) * 16;
        this._knock(o);
        return this._startTumble('x', -1);
      }
      // ground hit: the obstacle gets launched, you barely slow
      const kick = clamp(speed, 8, 34);
      o.vx = nx * kick * 0.95 + this.vel.x * 0.3;
      o.vz = nz * kick * 0.95 + this.vel.y * 0.3;
      o.vy = clamp(kick * 0.28, 2, 9);
      o.spin = (Math.random() - 0.5) * 18;
      this._knock(o);
      this.vel.multiplyScalar(0.86);
      this._shake(clamp(speed * 0.02, 0.15, 0.6));
    }
  }

  // first knock of each movable awards points + a debris burst
  _knock(o) {
    if (!o.knocked) {
      o.knocked = true;
      this.score += 150;
      const col = o.mesh.material.color ? o.mesh.material.color.getHex() : 0xffaa55;
      this._burstDebris(o.mesh.position.x, o.mesh.position.z, col, 6);
    }
    this.audio.crash();
  }

  _updateMovables(dt) {
    for (const o of this.movables) {
      const m = o.mesh;
      const moving = Math.abs(o.vx) + Math.abs(o.vz) + Math.abs(o.vy) > 0.05;
      if (!moving) continue;
      m.position.x += o.vx * dt; m.position.z += o.vz * dt;
      o.vy -= GRAVITY * 0.6 * dt;
      m.position.y += o.vy * dt;
      const rest = o.h * 0.25;        // resting height once toppled
      if (m.position.y < rest) { m.position.y = rest; o.vy *= -0.3; if (Math.abs(o.vy) < 1) o.vy = 0; }
      o.vx *= Math.pow(0.18, dt); o.vz *= Math.pow(0.18, dt);
      m.rotation.x += o.spin * dt * 0.6; m.rotation.z += o.spin * dt * 0.4;
      o.spin *= Math.pow(0.25, dt);
      m.position.x = clamp(m.position.x, -HALF + 1, HALF - 1);
      m.position.z = clamp(m.position.z, -HALF + 1, HALF - 1);
    }
  }

  _bank() {
    const gained = Math.floor(this.pending * this.mult);
    this.score += gained;
    this.audio.bank(this.mult);
    this.hud.bankFlash(gained, this.mult);
    this._shake(0.15 + Math.min(this.mult, 9) * 0.05);
    this.pending = 0; this.driftTime = 0; this.mult = 1; this.notDrift = 0;
    this.hud.setCombo(1, 0, false);
  }

  // ------------------------------------------------------------- effects --
  _emitSmoke(opacity, size, color) {
    const p = this.smoke[this.smokeCursor]; this.smokeCursor = (this.smokeCursor + 1) % this.smoke.length;
    p.mesh.position.set(this.pos.x + (Math.random() - 0.5) * 1.2, this.pos.y + 0.4, this.pos.z + (Math.random() - 0.5) * 1.2);
    p.size = size; p.life = 1;
    p.vx = (Math.random() - 0.5) * 2 - this.vel.x * 0.12;
    p.vz = (Math.random() - 0.5) * 2 - this.vel.y * 0.12;
    p.vy = 1.6 + Math.random() * 1.8;
    p.mesh.material.color.setHex(color);
    p.mesh.material.opacity = opacity; p.mesh.visible = true;
    p.fade = opacity;
  }
  _updateSmoke(dt) {
    for (const p of this.smoke) {
      if (p.life <= 0) continue;
      p.life -= dt * 0.9; p.size += dt * 3.4;
      p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
      p.mesh.scale.setScalar(p.size); p.mesh.quaternion.copy(this.camera.quaternion);
      p.mesh.material.opacity = Math.max(0, p.life) * p.fade;
      if (p.life <= 0) p.mesh.visible = false;
    }
  }

  _dropSkid() {
    const s = this.skids[this.skidCursor]; this.skidCursor = (this.skidCursor + 1) % this.skids.length;
    s.mesh.position.set(this.pos.x, 0.04, this.pos.z);
    s.mesh.rotation.z = Math.atan2(this.vel.x, this.vel.y);
    s.mesh.material.opacity = 0.55; s.mesh.visible = true; s.life = 1;
  }
  _fadeSkids(dt) {
    for (const s of this.skids) {
      if (s.life <= 0) continue;
      s.life -= dt * 0.2;
      s.mesh.material.opacity = Math.max(0, s.life) * 0.55;
      if (s.life <= 0) s.mesh.visible = false;
    }
  }

  _burstDebris(x, z, color, n = 6) {
    for (let i = 0; i < n; i++) {
      const p = this.debris[this.debrisCursor]; this.debrisCursor = (this.debrisCursor + 1) % this.debris.length;
      p.mesh.position.set(x, 1 + Math.random(), z);
      p.vx = (Math.random() - 0.5) * 12; p.vz = (Math.random() - 0.5) * 12; p.vy = 5 + Math.random() * 6;
      p.life = 1; p.mesh.material.color.setHex(color); p.mesh.material.opacity = 1;
      p.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      p.mesh.visible = true;
    }
  }
  _updateDebris(dt) {
    for (const p of this.debris) {
      if (p.life <= 0) continue;
      p.life -= dt * 1.3;
      p.vy -= GRAVITY * 0.8 * dt;
      p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
      if (p.mesh.position.y < 0.15) { p.mesh.position.y = 0.15; p.vy *= -0.4; }
      p.mesh.rotation.x += dt * 6; p.mesh.rotation.z += dt * 5;
      p.mesh.material.opacity = Math.max(0, p.life);
      if (p.life <= 0) p.mesh.visible = false;
    }
  }

  _updateCamera(dt, speed01, driftAmt) {
    this.shakeAmt = (this.shakeAmt || 0) * Math.pow(0.0001, dt);
    let d = this.theta - this.camYaw;
    while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    this.camYaw += d * Math.min(1, dt * 3.5);
    const bx = Math.sin(this.camYaw), bz = Math.cos(this.camYaw);
    const sx = (Math.random() - 0.5) * this.shakeAmt, sz = (Math.random() - 0.5) * this.shakeAmt;
    const back = CAM_BACK + speed01 * 4;
    const want = new THREE.Vector3(this.pos.x - bx * back + sx, CAM_H + speed01 * 2.5 + this.pos.y * 0.5, this.pos.z - bz * back + sz);
    this.camPos.lerp(want, 1 - Math.exp(-dt * 6));
    this.camLook.lerp(new THREE.Vector3(this.pos.x + bx * 7, this.pos.y + 1.5, this.pos.z + bz * 7), 1 - Math.exp(-dt * 6));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    const wantFov = 55 + speed01 * 13 + driftAmt * 6;
    this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, dt * 4);
    this.camera.updateProjectionMatrix();

    this.sun.position.set(this.pos.x + 10, 26, this.pos.z + 8);
    this.sun.target.position.set(this.pos.x, 0, this.pos.z);
    this.sun.target.updateMatrixWorld();
  }

  _shake(a) { this.shakeAmt = Math.min(2.5, (this.shakeAmt || 0) + a); }

  _loadBest() { try { return +localStorage.getItem('driftcube.best') || 0; } catch { return 0; } }
  _saveBest(v) { try { localStorage.setItem('driftcube.best', String(v)); } catch {} }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(w, h);
  }
}

// ---- procedural textures ---------------------------------------------------
function makeWoodTexture(light = '#b07d42', dark = '#7e5328') {
  const s = 128; const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, s);
  grd.addColorStop(0, dark); grd.addColorStop(0.5, light); grd.addColorStop(1, dark);
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(70,45,18,0.35)'; g.lineWidth = 1;
  for (let y = 4; y < s; y += 7 + Math.random() * 4) {
    g.beginPath();
    for (let x = 0; x <= s; x += 8) g.lineTo(x, y + Math.sin(x * 0.15) * 2);
    g.stroke();
  }
  for (let i = 0; i < 2; i++) {
    const kx = 20 + Math.random() * 88, ky = 20 + Math.random() * 88;
    g.strokeStyle = 'rgba(60,38,15,0.5)';
    for (let r = 2; r < 9; r += 2) { g.beginPath(); g.ellipse(kx, ky, r, r * 1.4, 0, 0, 7); g.stroke(); }
  }
  return new THREE.CanvasTexture(cv);
}

function makeFloorTexture() {
  const s = 256; const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  g.fillStyle = '#0b0e16'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(80,90,110,${0.04 + Math.random() * 0.10})`;
    g.fillRect(Math.random() * s, Math.random() * s, 1.4, 1.4);
  }
  g.shadowColor = 'rgba(42,157,255,0.9)'; g.shadowBlur = 8;
  g.strokeStyle = 'rgba(70,170,255,0.8)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 1.5); g.lineTo(s, 1.5); g.moveTo(1.5, 0); g.lineTo(1.5, s); g.stroke();
  return new THREE.CanvasTexture(cv);
}

function makePuff(strength = 0.9) {
  const s = 64; const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, `rgba(255,255,255,${strength})`);
  grd.addColorStop(0.5, `rgba(255,255,255,${strength * 0.4})`);
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}
