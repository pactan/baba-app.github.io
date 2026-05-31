import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
// Post-processing (bloom) is loaded dynamically below so a missing addon can
// never block the game from starting.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const HALF = 56;

// --- dynamic bicycle model (real vehicle dynamics) -------------------------
// We simulate the car as two lumped tires (front + rear). Each tire makes a
// lateral force proportional to its slip angle (the angle between where the
// tire points and where it's actually moving), saturating at the friction
// limit mu*load — this is what gives a *speed-dependent* grip: at low speed the
// slip angles are tiny so the car grips and CANNOT drift; at speed, or under
// handbrake (which slashes rear grip), the rear breaks away into a real slide.
const MASS = 1200;            // kg
const IZ = 1600;              // yaw moment of inertia (kg·m²)
const LF = 1.25;             // CG -> front axle (m)
const LR = 1.45;             // CG -> rear axle (m)  (rear-biased => playful)
const WHEEL_BASE = LF + LR;
const G = 9.81;
const MU = 1.55;             // tire-road friction coefficient (grip ceiling)
const CF = 95000;            // front cornering stiffness (N/rad)
const CR = 110000;           // rear cornering stiffness (N/rad)
const STEER_ANGLE = 0.55;    // max road-wheel steer (rad, ~31°)
const ENGINE_FORCE = 11000;  // drive force at the wheels (N)
const BRAKE_FORCE = 9000;    // engine-brake / coast deceleration force
const ROLL_DRAG = 0.4;       // linear rolling resistance per unit speed
const AIR_DRAG = 0.45;       // quadratic aero drag (caps top speed)
const MAX_DRIVE_SPD = 34;    // governed top speed (m/s)
const HANDBRAKE_GRIP = 0.45; // rear grip multiplier while drifting (locks rear)
const CAM_H = 38, CAM_DZ = -9;

const RUN_TIME = 60;         // Time Attack run length (s)
const GHOST_HZ = 20;         // ghost recording sample rate

// static axle loads (N) — used as the per-tire grip ceiling
const FZF = MASS * G * LR / WHEEL_BASE;
const FZR = MASS * G * LF / WHEEL_BASE;

export class Game {
  constructor(canvas, audio, input, hud) {
    this.audio = audio; this.input = input; this.hud = hud;
    this.onError = null;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06070b);
    this.scene.fog = new THREE.Fog(0x06070b, 38, 96);

    // image-based lighting for crisp reflections
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const env = new RoomEnvironment();
      this.scene.environment = pmrem.fromScene(env, 0.04).texture;
      env.dispose();
    } catch (e) { /* reflections optional */ }

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
    this.camPos = new THREE.Vector3(0, CAM_H, CAM_DZ);
    this.camLook = new THREE.Vector3(0, 0, 0);

    this._lights();
    this._world();
    this._car();
    this._skids();
    this._smoke();
    this._sparks();
    this._cones(26);
    this._ghostCar();
    this._post();

    this.best = this._loadBest();
    this.bestGhost = this._loadGhost();   // recorded path of the best run
    this._resetRun();
    this.running = false;
    this.hud.setBest(this.best);

    this.clock = new THREE.Clock();
    addEventListener('resize', () => this._resize());
    this._resize();
  }

  _lights() {
    this.scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x0a0c12, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 80;
    const d = 22; Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
    sun.shadow.bias = -0.0005; sun.shadow.radius = 4;
    this.scene.add(sun); this.scene.add(sun.target);
    this.sun = sun;
    const rim = new THREE.DirectionalLight(0x6ea8ff, 0.6);
    rim.position.set(-6, 5, -8); this.scene.add(rim);
  }

  _world() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF * 2 + 60, HALF * 2 + 60),
      new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.95, metalness: 0.0 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);

    const grid = new THREE.GridHelper(HALF * 2, 28, 0x2b3340, 0x191d25);
    grid.position.y = 0.02; this.scene.add(grid);

    // glowing boundary walls (bloom picks these up)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x0a1830, roughness: 0.4, metalness: 0.2, emissive: 0x0a84ff, emissiveIntensity: 1.3 });
    for (const s of [-1, 1]) {
      const wx = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 1, 1.2, 0.5), wallMat);
      wx.position.set(0, 0.6, s * HALF); wx.castShadow = wx.receiveShadow = true; this.scene.add(wx);
      const wz = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, HALF * 2 + 1), wallMat);
      wz.position.set(s * HALF, 0.6, 0); wz.castShadow = wz.receiveShadow = true; this.scene.add(wz);
    }
  }

  _car() {
    this.car = new THREE.Group();
    this.car.rotation.order = 'YXZ';

    this.bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a84ff, roughness: 0.28, metalness: 0.5, clearcoat: 1.0, clearcoatRoughness: 0.18,
      emissive: 0xff4400, emissiveIntensity: 0.0,
    });
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.55, 0.85, 1.7, 5, 0.26), this.bodyMat);
    body.position.y = 0.55; body.castShadow = true; this.car.add(body);

    const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.55, 0.95, 5, 0.18),
      new THREE.MeshPhysicalMaterial({ color: 0x0a1020, roughness: 0.15, metalness: 0.3, clearcoat: 1, transmission: 0.2, ior: 1.4 }));
    cabin.position.set(0, 1.0, -0.06); cabin.castShadow = true; this.car.add(cabin);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.42, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xbcd6ff, emissiveIntensity: 0.6, roughness: 0.4 }));
    nose.position.set(0, 0.55, 0.88); this.car.add(nose);

    // little wheels so skids read; dark rubber
    const wheelGeo = new RoundedBoxGeometry(0.34, 0.46, 0.5, 3, 0.12);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.8, metalness: 0 });
    this.wheels = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(sx * 0.82, 0.32, sz * 0.62); w.castShadow = true; this.car.add(w); this.wheels.push(w);
    }

    // underglow that warms with friction heat
    this.glow = new THREE.PointLight(0xff5a00, 0, 7, 2); this.glow.position.set(0, 0.3, 0); this.car.add(this.glow);

    this.scene.add(this.car);
  }

  // translucent replica that replays the best run
  _ghostCar() {
    this.ghost = new THREE.Group();
    this.ghost.rotation.order = 'YXZ';
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xff9f0a, roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.35,
      emissive: 0xff9f0a, emissiveIntensity: 0.5, depthWrite: false,
    });
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.55, 0.85, 1.7, 5, 0.26), mat);
    body.position.y = 0.55; this.ghost.add(body);
    const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.55, 0.95, 5, 0.18), mat);
    cabin.position.set(0, 1.0, -0.06); this.ghost.add(cabin);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
  }

  // reset all per-run state (called at construction and on restart)
  _resetRun() {
    this.pos = new THREE.Vector2(0, 0);
    this.vel = new THREE.Vector2(0, 0); // world-frame velocity (m/s)
    this.theta = 0;                     // heading (yaw)
    this.omega = 0;                     // yaw rate (rad/s)
    this.steerS = 0;                    // eased steering
    this.heat = 0;                      // tire/friction heat 0..1
    this.score = 0;
    this.pending = 0; this.driftTime = 0; this.mult = 1; this.notDrift = 0;
    this.timeLeft = RUN_TIME;
    this.finished = false;
    this.rec = [];                      // this run's ghost recording
    this.recT = 0;                      // accumulator for sampling
    this.ghostHasData = this.bestGhost && this.bestGhost.length > 1;
    this.ghost.visible = this.ghostHasData;
    if (this.skids) for (const s of this.skids) { s.life = 0; s.mesh.visible = false; }
    this.hud.setTime(this.timeLeft);
    this.hud.setScore(0);
    this.hud.hideResult();
  }

  // start a fresh Time Attack run
  restart() { this._resetRun(); this.running = true; }

  _skids() {
    const geo = new THREE.BoxGeometry(0.26, 0.02, 0.6);
    this.skids = [];
    for (let i = 0; i < 240; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x05060a, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; m.renderOrder = 1; this.scene.add(m);
      this.skids.push({ mesh: m, life: 0 });
    }
    this.skidCursor = 0; this.skidTimer = 0;
  }

  _smoke() {
    const tex = makePuff(0.85);
    this.smoke = [];
    for (let i = 0; i < 64; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.visible = false; this.scene.add(m);
      this.smoke.push({ mesh: m, life: 0, vx: 0, vz: 0, size: 1 });
    }
    this.smokeCursor = 0;
  }

  _sparks() {
    const tex = makePuff(1.0);
    this.sparkMatBase = new THREE.MeshBasicMaterial({ map: tex, color: 0xffb24d, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.sparks = [];
    for (let i = 0; i < 36; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), this.sparkMatBase.clone());
      m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 2; this.scene.add(m);
      this.sparks.push({ mesh: m, life: 0, vx: 0, vy: 0, vz: 0, y: 0 });
    }
    this.sparkCursor = 0;
  }

  _cones(n) {
    this.cones = [];
    const coneGeo = new THREE.ConeGeometry(0.32, 0.9, 18);
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.55, metalness: 0.1, emissive: 0x5a2400, emissiveIntensity: 0.5 });
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(coneGeo, coneMat); m.castShadow = true;
      this._placeCone(m); this.scene.add(m);
      this.cones.push({ mesh: m, vx: 0, vz: 0, spin: 0 });
    }
  }
  _placeCone(m) {
    let x, z;
    do { x = (Math.random() * 2 - 1) * (HALF - 6); z = (Math.random() * 2 - 1) * (HALF - 6); }
    while (Math.hypot(x, z) < 9);
    m.position.set(x, 0.45, z); m.rotation.set(0, Math.random() * 6, 0);
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
      c.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.55, 0.82));
      c.setSize(innerWidth, innerHeight);
      this.composer = c;
    } catch (e) { this.composer = null; } // fall back to direct rendering
  }

  start() { this._resetRun(); this.running = true; this.clock.getDelta(); this._loop(); }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 1 / 30);
    try {
      if (this.running) this._update(dt);
      if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    } catch (e) {
      this.running = false;
      if (this.onError) this.onError(e);
    }
  }

  _update(dt) {
    // --- Time Attack countdown ---
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) { this.timeLeft = 0; this._finish(); }
    this.hud.setTime(this.timeLeft);

    // sub-step the physics for stability at high forces / low frame rates
    const steps = 4;
    const h = dt / steps;
    this.steerS += (this.input.steer - this.steerS) * Math.min(1, dt * 16);
    const drift = this.input.drift;
    for (let i = 0; i < steps; i++) this._step(h, drift);

    const speed = this.vel.length();

    // --- record this run's path + replay the best-run ghost ---
    this.recT += dt;
    const elapsed = RUN_TIME - this.timeLeft;
    if (this.recT >= 1 / GHOST_HZ) {
      this.recT = 0;
      this.rec.push(+this.pos.x.toFixed(2), +this.pos.y.toFixed(2), +this.theta.toFixed(3));
    }
    if (this.ghostHasData) this._playGhost(elapsed);

    // velocity in the car's local frame (vx = longitudinal, vy = lateral)
    const cs = Math.cos(this.theta), sn = Math.sin(this.theta);
    const vx = this.vel.x * sn + this.vel.y * cs;   // forward
    const vy = this.vel.x * cs - this.vel.y * sn;   // right

    // place car + body lean into the slide
    const steerDir = -this.steerS * STEER_ANGLE;
    this.car.position.set(this.pos.x, 0, this.pos.y);
    this.car.rotation.y = this.theta;
    this.car.rotation.z += (clamp(vy * 0.04, -0.32, 0.32) - this.car.rotation.z) * Math.min(1, dt * 10);
    if (this.wheels) { this.wheels[1].rotation.y = -steerDir * 1.4; this.wheels[3].rotation.y = -steerDir * 1.4; }

    // --- drift detection from the body slip angle (β): angle between where the
    // car points and where it actually travels. Requires real speed, so a
    // slow car can no longer "drift". ---
    const beta = speed > 1.5 ? Math.abs(Math.atan2(vy, Math.abs(vx))) * 180 / Math.PI : 0;
    const drifting = speed > 6 && beta > 10;
    const driftAmt = drifting ? clamp((beta - 10) / 35, 0, 1) : 0;

    if (drifting) {
      this.driftTime += dt; this.notDrift = 0;
      this.mult = clamp(1 + Math.floor(this.driftTime / 1.4), 1, 8);
      this.pending += speed * driftAmt * dt * 6;
      this.hud.setCombo(this.mult, Math.floor(this.pending * this.mult), true);
    } else if (this.pending > 0) {
      this.notDrift += dt;
      if (this.notDrift > 0.5) this._bank();
    }

    // --- friction heat (builds with sustained drift, decays) ---
    this.heat = clamp(this.heat + (driftAmt * clamp(speed / 26, 0, 1) * 0.85 - 0.35) * dt, 0, 1);
    this.bodyMat.emissiveIntensity = this.heat * 0.45;
    this.glow.intensity = this.heat * 3.0;
    this.glow.color.setHSL(clamp(0.08 - this.heat * 0.08, 0, 0.1), 1, 0.5);

    // --- skids + smoke + sparks ---
    this.skidTimer += dt;
    if (driftAmt > 0.08 && speed > 6 && this.skidTimer > 0.016) {
      this.skidTimer = 0;
      const a = Math.atan2(this.vel.x, this.vel.y);
      this._dropSkid(-0.6, 0.62, a); this._dropSkid(-0.6, -0.62, a);
      this._emitSmoke(driftAmt); this._emitSmoke(driftAmt);
      if (this.heat > 0.5 && Math.random() < this.heat) this._emitSpark();
    }
    this._fadeSkids(dt); this._updateSmoke(dt); this._updateSparks(dt); this._updateCones(dt);

    // --- camera: smooth, frame-rate-independent ---
    const k = 1 - Math.exp(-dt * 6);
    this.camPos.lerp(new THREE.Vector3(this.pos.x, CAM_H, this.pos.y + CAM_DZ), k);
    this.camLook.lerp(new THREE.Vector3(this.pos.x, 0, this.pos.y), k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    this.sun.position.set(this.pos.x + 12, 26, this.pos.y + 6);
    this.sun.target.position.set(this.pos.x, 0, this.pos.y);
    this.sun.target.updateMatrixWorld();

    this.audio.engine(clamp(speed / MAX_DRIVE_SPD, 0, 1));
    this.audio.screech(driftAmt * clamp(speed / 10, 0, 1));

    this.hud.setScore(this.score);
  }

  // One physics sub-step of the dynamic bicycle model.
  _step(h, drift) {
    const cs = Math.cos(this.theta), sn = Math.sin(this.theta);
    // world velocity -> body frame: vx forward (+heading), vy lateral (+right)
    let vx = this.vel.x * sn + this.vel.y * cs;
    let vy = this.vel.x * cs - this.vel.y * sn;
    const omega = this.omega;
    const delta = -this.steerS * STEER_ANGLE; // road-wheel steer angle

    // throttle/brake along the body x-axis (auto-throttle, eased on handbrake)
    let drive = ENGINE_FORCE * (drift ? 0.35 : 1) * (1 - clamp(vx / MAX_DRIVE_SPD, 0, 1));
    if (vx < 0) drive = ENGINE_FORCE * 0.5; // creep out of reverse

    // --- slip angles (rad). atan of lateral vs longitudinal velocity at each
    // axle; the front axle subtracts the steer angle. eps keeps it sane at v~0.
    const eps = 0.5;
    const vxs = Math.max(Math.abs(vx), eps) * Math.sign(vx || 1);
    const alphaF = Math.atan2(vy + LF * omega, Math.abs(vxs)) - delta;
    const alphaR = Math.atan2(vy - LR * omega, Math.abs(vxs));

    // --- lateral tire forces: linear in slip, saturated at the friction
    // circle (mu * load). This is the key to realism: at low speed slip angles
    // are tiny so forces stay well inside the grip limit (no drift); push hard
    // or yank the handbrake and the rear saturates and breaks away.
    const rearGrip = drift ? HANDBRAKE_GRIP : 1;
    let Fyf = -CF * alphaF;
    let Fyr = -CR * alphaR;
    const maxF = MU * FZF;
    const maxR = MU * FZR * rearGrip;
    Fyf = clamp(Fyf, -maxF, maxF);
    Fyr = clamp(Fyr, -maxR, maxR);

    // --- longitudinal force: drive minus rolling + aero drag ---
    const Fdrive = drive - (vx > 0 ? BRAKE_FORCE * 0 : 0);
    const Fdrag = -ROLL_DRAG * MASS * vx - AIR_DRAG * vx * Math.abs(vx);

    // --- body-frame accelerations (coupled with yaw via the omega terms) ---
    const ax = (Fdrive + Fdrag - Fyf * Math.sin(delta)) / MASS + vy * omega;
    const ay = (Fyf * Math.cos(delta) + Fyr) / MASS - vx * omega;
    const aOmega = (LF * Fyf * Math.cos(delta) - LR * Fyr) / IZ;

    vx += ax * h;
    vy += ay * h;
    this.omega += aOmega * h;

    // strong yaw damping at very low speed so the car settles instead of
    // wobbling/spinning in place (numerical + physical low-speed behaviour)
    if (Math.abs(vx) < 2) this.omega *= (1 - 3 * h);
    this.omega *= (1 - 0.6 * h);

    // body frame -> world velocity
    this.vel.x = vx * sn + vy * cs;
    this.vel.y = vx * cs - vy * sn;

    // integrate pose
    this.theta += this.omega * h;
    this.pos.addScaledVector(this.vel, h);

    // boundary bounce
    for (const ax2 of ['x', 'y']) {
      if (this.pos[ax2] > HALF - 1) { this.pos[ax2] = HALF - 1; this.vel[ax2] *= -0.4; this.omega *= 0.6; }
      if (this.pos[ax2] < -(HALF - 1)) { this.pos[ax2] = -(HALF - 1); this.vel[ax2] *= -0.4; this.omega *= 0.6; }
    }
  }


  _bank() {
    const gained = Math.floor(this.pending * this.mult);
    this.score += gained;
    this.audio.bank(this.mult);
    this.hud.bankFlash(gained, this.mult);
    this.pending = 0; this.driftTime = 0; this.mult = 1; this.notDrift = 0;
    this.hud.setCombo(1, 0, false);
  }

  // end of run: bank any pending combo, save best score + ghost, show results
  _finish() {
    if (this.finished) return;
    this.finished = true;
    this.running = false;
    if (this.pending > 0) this.score += Math.floor(this.pending * this.mult);
    this.hud.setCombo(1, 0, false);
    this.audio.engine(0); this.audio.screech(0);

    const isBest = this.score > this.best;
    if (isBest) {
      this.best = this.score;
      this._saveBest(this.best);
      this.hud.setBest(this.best);
      this.bestGhost = this.rec;            // this run becomes the ghost to beat
      this._saveGhost(this.rec);
      this.audio.bank(8);                    // celebratory chime
    }
    this.hud.showResult(this.score, this.best, isBest);
  }

  // interpolate the ghost car along the recorded best run
  _playGhost(elapsed) {
    const g = this.bestGhost;
    const n = g.length / 3;
    const f = elapsed * GHOST_HZ;          // fractional sample index
    let i = Math.floor(f);
    if (i >= n - 1) { i = n - 2; }
    if (i < 0) { this.ghost.visible = false; return; }
    const t = clamp(f - i, 0, 1);
    const ax = g[i * 3], az = g[i * 3 + 1], ath = g[i * 3 + 2];
    const bx = g[i * 3 + 3], bz = g[i * 3 + 4]; let bth = g[i * 3 + 5];
    // shortest-arc angle interp
    let dth = bth - ath; if (dth > Math.PI) dth -= 2 * Math.PI; if (dth < -Math.PI) dth += 2 * Math.PI;
    this.ghost.visible = true;
    this.ghost.position.set(ax + (bx - ax) * t, 0, az + (bz - az) * t);
    this.ghost.rotation.y = ath + dth * t;
  }

  _dropSkid(offF, offR, angle) {
    const f = new THREE.Vector2(Math.sin(this.theta), Math.cos(this.theta));
    const r = new THREE.Vector2(Math.cos(this.theta), -Math.sin(this.theta));
    const s = this.skids[this.skidCursor]; this.skidCursor = (this.skidCursor + 1) % this.skids.length;
    s.mesh.position.set(this.pos.x + f.x * offF + r.x * offR, 0.03, this.pos.y + f.y * offF + r.y * offR);
    s.mesh.rotation.y = angle;
    // hotter rubber leaves slightly warmer, more opaque marks
    s.mesh.material.color.setRGB(0.02 + this.heat * 0.12, 0.02 + this.heat * 0.01, 0.04);
    s.mesh.material.opacity = 0.5; s.mesh.visible = true; s.life = 1;
  }
  _fadeSkids(dt) {
    for (const s of this.skids) {
      if (s.life <= 0) continue;
      s.life -= dt * 0.16;
      s.mesh.material.opacity = Math.max(0, s.life) * 0.5;
      if (s.life <= 0) s.mesh.visible = false;
    }
  }

  _emitSmoke(amt) {
    const f = new THREE.Vector2(Math.sin(this.theta), Math.cos(this.theta));
    const r = new THREE.Vector2(Math.cos(this.theta), -Math.sin(this.theta));
    const side = (Math.random() - 0.5) * 1.2;
    const p = this.smoke[this.smokeCursor]; this.smokeCursor = (this.smokeCursor + 1) % this.smoke.length;
    p.mesh.position.set(this.pos.x - f.x * 0.7 + r.x * side, 0.12, this.pos.y - f.y * 0.7 + r.y * side);
    p.size = 0.9 + Math.random() * 0.4; p.life = 1;
    p.vx = (Math.random() - 0.5) * 2.0 - this.vel.x * 0.12;
    p.vz = (Math.random() - 0.5) * 2.0 - this.vel.y * 0.12;
    p.mesh.material.opacity = 0.55 * (0.4 + amt); p.mesh.visible = true;
  }
  _updateSmoke(dt) {
    for (const p of this.smoke) {
      if (p.life <= 0) continue;
      p.life -= dt * 0.7; p.size += dt * 4.5;
      p.mesh.position.x += p.vx * dt; p.mesh.position.z += p.vz * dt;
      p.mesh.scale.setScalar(p.size);
      p.mesh.material.opacity = Math.max(0, p.life) * 0.45;
      if (p.life <= 0) p.mesh.visible = false;
    }
  }

  _emitSpark() {
    const f = new THREE.Vector2(Math.sin(this.theta), Math.cos(this.theta));
    const p = this.sparks[this.sparkCursor]; this.sparkCursor = (this.sparkCursor + 1) % this.sparks.length;
    p.y = 0.25;
    p.mesh.position.set(this.pos.x - f.x * 0.7 + (Math.random() - 0.5) * 0.6, p.y, this.pos.y - f.y * 0.7 + (Math.random() - 0.5) * 0.6);
    p.vx = (Math.random() - 0.5) * 4 - this.vel.x * 0.15;
    p.vz = (Math.random() - 0.5) * 4 - this.vel.y * 0.15;
    p.vy = 2 + Math.random() * 3;
    p.life = 1; p.mesh.material.opacity = 0.9; p.mesh.scale.setScalar(0.6 + Math.random() * 0.6); p.mesh.visible = true;
  }
  _updateSparks(dt) {
    for (const p of this.sparks) {
      if (p.life <= 0) continue;
      p.life -= dt * 2.2; p.vy -= 14 * dt; p.y += p.vy * dt;
      if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.4; }
      p.mesh.position.set(p.mesh.position.x + p.vx * dt, p.y, p.mesh.position.z + p.vz * dt);
      p.mesh.material.opacity = Math.max(0, p.life);
      if (p.life <= 0) p.mesh.visible = false;
    }
  }

  _updateCones(dt) {
    const carR = 1.15;
    for (const c of this.cones) {
      const m = c.mesh;
      const dx = m.position.x - this.pos.x, dz = m.position.z - this.pos.y;
      const dist = Math.hypot(dx, dz);
      if (dist < carR + 0.4) {
        const n = 1 / (dist || 1);
        const impact = clamp(this.vel.length(), 4, 24);
        c.vx = dx * n * impact + this.vel.x * 0.4;
        c.vz = dz * n * impact + this.vel.y * 0.4;
        c.spin = (Math.random() - 0.5) * 16;
      }
      if (Math.abs(c.vx) + Math.abs(c.vz) > 0.01) {
        m.position.x += c.vx * dt; m.position.z += c.vz * dt;
        c.vx *= Math.pow(0.06, dt); c.vz *= Math.pow(0.06, dt);
        m.rotation.x += c.spin * dt * 0.3; m.rotation.z += c.spin * dt * 0.2; c.spin *= Math.pow(0.2, dt);
        m.position.x = clamp(m.position.x, -HALF + 1, HALF - 1);
        m.position.z = clamp(m.position.z, -HALF + 1, HALF - 1);
      }
    }
  }

  _loadBest() { try { return +localStorage.getItem('drift.best') || 0; } catch { return 0; } }
  _saveBest(v) { try { localStorage.setItem('drift.best', String(v)); } catch {} }
  _loadGhost() { try { return JSON.parse(localStorage.getItem('drift.ghost')) || null; } catch { return null; } }
  _saveGhost(arr) { try { localStorage.setItem('drift.ghost', JSON.stringify(arr)); } catch {} }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(w, h);
  }
}

function makePuff(strength = 0.9) {  const s = 64; const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, `rgba(255,255,255,${strength})`);
  grd.addColorStop(0.5, `rgba(230,235,245,${strength * 0.35})`);
  grd.addColorStop(1, 'rgba(230,235,245,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}
