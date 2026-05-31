import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
// Post-processing (bloom) is loaded dynamically below so a missing addon can
// never block the game from starting.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const HALF = 120;   // big arena (240 x 240)

// --- snappy ARCADE drift model --------------------------------------------
// Not a simulator. The car is light and responsive: instant throttle, quick
// steering, tight grip by default (no low-speed sliding) — and pressing DRIFT
// above a speed threshold cuts rear grip so the tail swings out into a big,
// controllable, dopamine-y slide. Realism is faked where it feels good.
const ACCEL = 70;            // forward acceleration (u/s²) — punchy
const MAX_SPD = 46;          // top speed (u/s)
const REVERSE_SPD = 12;
const FWD_DRAG = 0.7;        // natural slow-down
const TURN_RATE = 3.4;       // max steering yaw rate (rad/s)
const TURN_SPEEDREF = 13;    // speed for full steering authority
const GRIP = 11;             // lateral grip when gripping (high = tight)
const DRIFT_GRIP = 1.7;      // lateral grip while drifting (low = slides)
const DRIFT_TURN_BOOST = 1.7;// extra steering while drifting (swings the tail)
const DRIFT_MIN_SPD = 11;    // must be going this fast to break traction
const CAM_H = 15, CAM_DZ = -13; // lower + further back => tilted 3D chase view

const RUN_TIME = 60;         // Time Attack run length (s)
const GHOST_HZ = 20;         // ghost recording sample rate

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
    this.scene.background = new THREE.Color(0x06070b);
    this.scene.fog = new THREE.Fog(0x06070b, 38, 96);

    // image-based lighting for crisp reflections
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const env = new RoomEnvironment();
      this.scene.environment = pmrem.fromScene(env, 0.04).texture;
      env.dispose();
    } catch (e) { /* reflections optional */ }

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 400);
    this.camPos = new THREE.Vector3(0, CAM_H, CAM_DZ);
    this.camLook = new THREE.Vector3(0, 0, 0);
    this.shakeAmt = 0;

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
    this.scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x2a3040, 0.35));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
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
    // DARK theme: a near-black asphalt floor can never wash out to white, no
    // matter how strong the bloom — the real-GPU bug was a bright floor being
    // blown out. Neon grid + landmarks give the speed reference instead.
    this.scene.background = new THREE.Color(0x05060a);
    this.scene.fog = new THREE.Fog(0x05060a, 70, 185);

    const tex = makeFloorTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(40, 40);
    tex.anisotropy = 8;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF * 2 + 120, HALF * 2 + 120),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);

    // glowing neon boundary walls
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x05122a, roughness: 0.3, metalness: 0.4, emissive: 0x2a9dff, emissiveIntensity: 2.2 });
    for (const s of [-1, 1]) {
      const wx = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 1, 1.8, 0.7), wallMat);
      wx.position.set(0, 0.9, s * HALF); wx.castShadow = wx.receiveShadow = true; this.scene.add(wx);
      const wz = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.8, HALF * 2 + 1), wallMat);
      wz.position.set(s * HALF, 0.9, 0); wz.castShadow = wz.receiveShadow = true; this.scene.add(wz);
    }

    this._obstacles();   // big complex level: blocks, pillars, barriers
  }

  // Solid obstacles the car collides with. Each registers a circular collider
  // { x, z, r } used by the cheap collision test in _update.
  _obstacles() {
    this.blockers = [];
    const addBlock = (x, z, w, d, h, color, emissive) => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, 0.18),
        new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.3, emissive, emissiveIntensity: emissive ? 1.4 : 0 }));
      m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true; this.scene.add(m);
      this.blockers.push({ x, z, r: Math.max(w, d) * 0.5 + 0.7 });
    };
    const addPillar = (x, z, color) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 5, 16),
        new THREE.MeshStandardMaterial({ color: 0x0a0e18, roughness: 0.3, metalness: 0.4, emissive: color, emissiveIntensity: 1.7 }));
      m.position.set(x, 2.5, z); m.castShadow = true; this.scene.add(m);
      this.blockers.push({ x, z, r: 2.2 });
    };

    // neon corner pillars
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) addPillar(sx * (HALF - 16), sz * (HALF - 16), sx * sz > 0 ? 0xff2a6d : 0x2affd0);

    // central "downtown" cluster to weave through
    addBlock(0, 0, 12, 12, 7, 0x141a2a, 0x2a9dff);
    addBlock(-26, 16, 9, 5, 4, 0x1a1230, 0xb44dff);
    addBlock(24, -22, 5, 14, 4, 0x1a1230, 0xb44dff);
    addBlock(30, 26, 7, 7, 5, 0x141a2a, 0x2a9dff);
    addBlock(-32, -24, 8, 8, 5, 0x141a2a, 0x2a9dff);

    // scattered mid-field barriers across the big arena
    const spots = [[-70, 50], [62, 64], [-58, -66], [72, -52], [0, 78], [-82, 0], [84, 10], [16, -80], [-40, 80], [48, -84]];
    for (const [x, z] of spots) addBlock(x, z, 6, 6, 4, 0x161d2e, 0x18d0a0);

    // a ring of low barriers to carve drifts around
    const ringN = 12, ringR = 52;
    for (let i = 0; i < ringN; i++) {
      const a = (i / ringN) * Math.PI * 2;
      addBlock(Math.cos(a) * ringR, Math.sin(a) * ringR, 3.5, 3.5, 2.5, 0x20283a, 0xff9f0a);
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
    this.pos = new THREE.Vector2(0, -75);   // open spot near the south wall
    this.vel = new THREE.Vector2(0, 0); // world-frame velocity (u/s)
    this.theta = 0;                     // heading (yaw)
    this.steerS = 0;                    // eased steering
    this.heat = 0;                      // tire/friction heat 0..1
    this.shakeAmt = 0;
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
      c.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.5, 0.9));
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

    // snappy steering: reach input fast (no mushy lag)
    this.steerS += (this.input.steer - this.steerS) * Math.min(1, dt * 26);
    const drift = this.input.drift;

    // --- ARCADE physics: forward/lateral split in the body frame ---
    const cs = Math.cos(this.theta), sn = Math.sin(this.theta);
    let vFwd = this.vel.x * sn + this.vel.y * cs;
    let vLat = this.vel.x * cs - this.vel.y * sn;

    // throttle (instant) + drag; eased a touch on handbrake for control
    vFwd += ACCEL * (drift ? 0.55 : 1) * dt;
    vFwd -= vFwd * FWD_DRAG * dt;
    vFwd = clamp(vFwd, -REVERSE_SPD, MAX_SPD);

    // can the tail break loose? only with real speed (no crawl-drifting)
    const fast = Math.abs(vFwd) > DRIFT_MIN_SPD;
    const sliding = drift && fast;

    // steering authority scales with speed; drifting swings the tail harder
    const authority = clamp(Math.abs(vFwd) / TURN_SPEEDREF, 0, 1);
    const turn = this.steerS * TURN_RATE * authority * (sliding ? DRIFT_TURN_BOOST : 1);
    this.theta += turn * dt * (vFwd >= 0 ? 1 : -1);

    // lateral grip: tight normally, loose while sliding => the drift
    const grip = sliding ? DRIFT_GRIP : GRIP;
    vLat -= vLat * grip * dt;
    // a kick of lateral velocity when you initiate the slide, for that snap
    if (sliding) vLat += this.steerS * Math.abs(vFwd) * 0.9 * dt;

    // recompose to world velocity with the NEW heading (mismatch = drift)
    const cs2 = Math.cos(this.theta), sn2 = Math.sin(this.theta);
    this.vel.x = vFwd * sn2 + vLat * cs2;
    this.vel.y = vFwd * cs2 - vLat * sn2;

    // integrate + bouncy walls (with a little shake)
    this.pos.addScaledVector(this.vel, dt);
    for (const ax of ['x', 'y']) {
      if (this.pos[ax] > HALF - 1) { this.pos[ax] = HALF - 1; this.vel[ax] *= -0.5; this._shake(0.5); }
      if (this.pos[ax] < -(HALF - 1)) { this.pos[ax] = -(HALF - 1); this.vel[ax] *= -0.5; this._shake(0.5); }
    }

    // --- obstacle collision: push out of circular colliders + bounce ---
    const CAR_R = 1.1;
    if (this.blockers) for (const b of this.blockers) {
      const dx = this.pos.x - b.x, dz = this.pos.y - b.z;
      const d = Math.hypot(dx, dz), min = b.r + CAR_R;
      if (d < min && d > 1e-3) {
        const nx = dx / d, nz = dz / d;
        this.pos.x = b.x + nx * min;            // push out along the normal
        this.pos.y = b.z + nz * min;
        const vdot = this.vel.x * nx + this.vel.y * nz;
        if (vdot < 0) {                          // reflect inward velocity
          this.vel.x -= 1.5 * vdot * nx;
          this.vel.y -= 1.5 * vdot * nz;
          this._shake(clamp(-vdot * 0.08, 0, 1.2));
        }
      }
    }

    const speed = this.vel.length();

    // --- record path + replay the best-run ghost ---
    this.recT += dt;
    const elapsed = RUN_TIME - this.timeLeft;
    if (this.recT >= 1 / GHOST_HZ) {
      this.recT = 0;
      this.rec.push(+this.pos.x.toFixed(2), +this.pos.y.toFixed(2), +this.theta.toFixed(3));
    }
    if (this.ghostHasData) this._playGhost(elapsed);

    // place car + lean/squat into the slide
    this.car.position.set(this.pos.x, 0, this.pos.y);
    this.car.rotation.y = this.theta;
    this.car.rotation.z += (clamp(vLat * 0.045, -0.4, 0.4) - this.car.rotation.z) * Math.min(1, dt * 12);
    if (this.wheels) { this.wheels[1].rotation.y = this.steerS * 0.5; this.wheels[3].rotation.y = this.steerS * 0.5; }

    // --- drift amount from how sideways we're moving ---
    const slip = speed > 2 ? Math.abs(Math.atan2(vLat, Math.abs(vFwd))) * 180 / Math.PI : 0;
    const drifting = sliding && slip > 8 && speed > 8;
    const driftAmt = drifting ? clamp((slip - 8) / 30, 0, 1) : 0;

    if (drifting) {
      this.driftTime += dt; this.notDrift = 0;
      this.mult = clamp(1 + Math.floor(this.driftTime / 1.2), 1, 10);
      this.pending += speed * driftAmt * dt * 7;
      this.hud.setCombo(this.mult, Math.floor(this.pending * this.mult), true);
    } else if (this.pending > 0) {
      this.notDrift += dt;
      if (this.notDrift > 0.45) this._bank();
    }

    // --- friction heat (builds with sustained drift, decays) ---
    this.heat = clamp(this.heat + (driftAmt * clamp(speed / 26, 0, 1) * 0.9 - 0.4) * dt, 0, 1);
    this.bodyMat.emissiveIntensity = this.heat * 0.5;
    this.glow.intensity = this.heat * 3.5;
    this.glow.color.setHSL(clamp(0.08 - this.heat * 0.08, 0, 0.1), 1, 0.5);

    // --- skids + smoke + sparks ---
    this.skidTimer += dt;
    if (driftAmt > 0.05 && speed > 8 && this.skidTimer > 0.014) {
      this.skidTimer = 0;
      const a = Math.atan2(this.vel.x, this.vel.y);
      this._dropSkid(-0.6, 0.62, a); this._dropSkid(-0.6, -0.62, a);
      this._emitSmoke(driftAmt); this._emitSmoke(driftAmt);
      if (this.heat > 0.45 && Math.random() < this.heat) this._emitSpark();
      this._shake(driftAmt * 0.18);
    }
    this._fadeSkids(dt); this._updateSmoke(dt); this._updateSparks(dt); this._updateCones(dt);

    // --- DYNAMIC camera: close, pulls back + FOV punch with speed, shakes ---
    const sp01 = clamp(speed / MAX_SPD, 0, 1);
    this.shakeAmt *= Math.pow(0.0001, dt); // decay
    const sx = (Math.random() - 0.5) * this.shakeAmt;
    const sz = (Math.random() - 0.5) * this.shakeAmt;
    // look slightly ahead of the car in the travel direction for anticipation
    const lead = 0.18;
    const tx = this.pos.x + this.vel.x * lead;
    const tz = this.pos.y + this.vel.y * lead;
    const k = 1 - Math.exp(-dt * 9); // snappier follow
    const wantH = CAM_H + sp01 * 7;             // pull back when fast
    const wantDz = CAM_DZ - sp01 * 4;
    this.camPos.lerp(new THREE.Vector3(tx + sx, wantH, tz + wantDz + sz), k);
    this.camLook.lerp(new THREE.Vector3(tx, 0, tz), k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    const wantFov = 52 + sp01 * 16 + driftAmt * 6; // FOV opens with speed/drift
    this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, dt * 5);
    this.camera.updateProjectionMatrix();

    this.sun.position.set(this.pos.x + 12, 26, this.pos.y + 6);
    this.sun.target.position.set(this.pos.x, 0, this.pos.y);
    this.sun.target.updateMatrixWorld();

    this.audio.engine(clamp(Math.abs(vFwd) / MAX_SPD, 0, 1));
    this.audio.screech(driftAmt * clamp(speed / 12, 0, 1));

    this.hud.setScore(this.score);
  }

  _shake(amt) { this.shakeAmt = Math.min(2.5, (this.shakeAmt || 0) + amt); }


  _bank() {
    const gained = Math.floor(this.pending * this.mult);
    this.score += gained;
    this.audio.bank(this.mult);
    this.hud.bankFlash(gained, this.mult);
    this._shake(0.2 + Math.min(this.mult, 10) * 0.08); // satisfying punch on cash-in
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

// dark asphalt tile with a glowing cyan seam — reads as a neon grid, and can
// never wash out to white because the tile itself is near-black.
function makeFloorTexture() {
  const s = 256; const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  // dark asphalt base
  g.fillStyle = '#0b0e16'; g.fillRect(0, 0, s, s);
  // subtle speckle
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(80,90,110,${0.04 + Math.random() * 0.10})`;
    g.fillRect(Math.random() * s, Math.random() * s, 1.4, 1.4);
  }
  // glowing grid seam along two edges (tiles tile seamlessly)
  g.shadowColor = 'rgba(42,157,255,0.9)'; g.shadowBlur = 8;
  g.strokeStyle = 'rgba(70,170,255,0.85)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 1.5); g.lineTo(s, 1.5); g.moveTo(1.5, 0); g.lineTo(1.5, s); g.stroke();
  return new THREE.CanvasTexture(cv);
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
