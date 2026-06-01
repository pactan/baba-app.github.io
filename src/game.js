import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
// Bloom is loaded dynamically below so a missing addon can't block startup.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// --- tuning ---------------------------------------------------------------
const SPEED = 26;          // CONSTANT forward speed (never changes)
const TURN = 2.7;          // steering yaw rate (rad/s)
const GRIP = 3.2;          // how fast velocity catches up to heading (low = more drift)
const GRAVITY = 55;
const JUMP_V = 17;         // jump launch velocity
const CUBE = 2.2;          // cube size

const T = 15;              // platform tile size
const GRID = 7;            // cells span -GRID..GRID  (15x15 tiles)
const HOLE_CHANCE = 0.2;   // fraction of tiles that are missing (gaps)

const CAM_BACK = 13, CAM_H = 12; // chase camera offset

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
    this.scene.fog = new THREE.Fog(0x0a0e1c, 60, 165);
    this._sky();

    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const env = new RoomEnvironment();
      this.scene.environment = pmrem.fromScene(env, 0.04).texture;
      env.dispose();
    } catch (e) {}

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
    this.camPos = new THREE.Vector3(0, CAM_H, -CAM_BACK);
    this.camLook = new THREE.Vector3();
    this.camYaw = 0;

    this._lights();
    this._cube();
    this._trail();
    this._smoke();
    this._fire();
    this._coins();
    this._post();

    this.best = this._loadBest();
    this.platforms = null;
    this._buildLevel();
    this._resetRun();
    this.running = false;
    this.hud.setBest(this.best);

    this.clock = new THREE.Clock();
    addEventListener('resize', () => this._resize());
    this._resize();
  }

  // big gradient sky dome (deep blue -> dusk purple) so the world has a horizon
  _sky() {
    const geo = new THREE.SphereGeometry(280, 32, 16);
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
    // a couple of distant glowing "moons" for depth
    for (const [x, y, z, c, r] of [[-120, 70, -160, 0x6ad0ff, 14], [150, 95, -120, 0xff7ad0, 9]]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16),
        new THREE.MeshBasicMaterial({ color: c }));
      m.position.set(x, y, z); this.scene.add(m);
    }
  }

  _lights() {
    this.scene.add(new THREE.HemisphereLight(0x8aa0ff, 0x0a0c16, 0.55));
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.0);
    sun.position.set(10, 24, 8); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 90;
    const d = 40; Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
    sun.shadow.bias = -0.0004; sun.shadow.radius = 4;
    this.scene.add(sun); this.scene.add(sun.target);
    this.sun = sun;
  }

  _cube() {
    this.cube = new THREE.Group();
    this.cube.rotation.order = 'YXZ';
    this.woodMat = new THREE.MeshStandardMaterial({ map: makeWoodTexture(), roughness: 0.65, metalness: 0.0,
      emissive: 0xff2200, emissiveIntensity: 0 });
    const geo = new RoundedBoxGeometry(CUBE, CUBE, CUBE, 5, 0.16);
    const box = new THREE.Mesh(geo, this.woodMat);
    box.castShadow = true; box.position.y = CUBE / 2;
    this.cube.add(box);
    // crisp dark edge outline (reads great against the bright platforms)
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(CUBE, CUBE, CUBE)),
      new THREE.LineBasicMaterial({ color: 0x2a1c0e }));
    edges.position.y = CUBE / 2; this.cube.add(edges);
    // front marker
    const nose = new THREE.Mesh(new THREE.BoxGeometry(CUBE * 0.5, 0.14, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x120c06, roughness: 0.6 }));
    nose.position.set(0, CUBE * 0.5, CUBE * 0.5 + 0.01); this.cube.add(nose);
    this.scene.add(this.cube);
    // soft contact shadow blob (kept flat on the ground, not parented to cube)
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(CUBE * 1.7, CUBE * 1.7),
      new THREE.MeshBasicMaterial({ map: makePuff(0.7), color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2; this.scene.add(this.blob);
  }

  // drift trail: a recycled pool of dark scorch quads laid on the platforms
  _trail() {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.trail = [];
    for (let i = 0; i < 160; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0x120a08, transparent: true, opacity: 0, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.visible = false; this.scene.add(m);
      this.trail.push({ mesh: m, life: 0 });
    }
    this.trailCursor = 0; this.trailTimer = 0;
  }

  _smoke() {
    const tex = makePuff(0.8);
    this.smoke = [];
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: tex, color: 0x555555, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; this.scene.add(m);
      this.smoke.push({ mesh: m, life: 0, vx: 0, vy: 0, vz: 0, size: 1 });
    }
    this.smokeCursor = 0;
  }

  _fire() {
    const tex = makePuff(1.0);
    this.fireMat = new THREE.MeshBasicMaterial({ map: tex, color: 0xff7a18, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false });
    this.flames = [];
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.fireMat.clone());
      m.visible = false; this.scene.add(m);
      this.flames.push({ mesh: m, life: 0, vx: 0, vy: 0, vz: 0, size: 1 });
    }
    this.fireCursor = 0;
    // light that flares when ablaze
    this.fireLight = new THREE.PointLight(0xff6014, 0, 16, 2);
    this.scene.add(this.fireLight);
  }

  _coins() {
    this.coins = [];
    const geo = new THREE.TorusGeometry(0.6, 0.22, 10, 18);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.3, metalness: 0.6, emissive: 0xffae00, emissiveIntensity: 0.7 });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(geo, mat); m.rotation.x = Math.PI / 2; m.castShadow = true;
      m.visible = false; this.scene.add(m);
      this.coins.push({ mesh: m, alive: false });
    }
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

  // --- LEVEL: a grid of platforms, some present, some missing (gaps) -------
  _buildLevel() {
    if (this.platMesh) { this.scene.remove(this.platMesh); this.platMesh.geometry.dispose(); }
    this.solid = new Set();
    const cells = [];
    for (let i = -GRID; i <= GRID; i++) {
      for (let j = -GRID; j <= GRID; j++) {
        // keep a safe 3x3 platform around spawn (0,0); holes elsewhere
        const safe = Math.abs(i) <= 1 && Math.abs(j) <= 1;
        if (safe || Math.random() > HOLE_CHANCE) { this.solid.add(i + ',' + j); cells.push([i, j]); }
      }
    }
    // one instanced mesh for all platforms (cheap on mobile)
    const geo = new RoundedBoxGeometry(T * 0.95, 3, T * 0.95, 3, 0.35);
    const mat = new THREE.MeshStandardMaterial({ map: makeTileTexture(), roughness: 0.55, metalness: 0.15,
      emissive: 0x12305a, emissiveIntensity: 0.55 });
    const inst = new THREE.InstancedMesh(geo, mat, cells.length);
    inst.receiveShadow = true; inst.castShadow = true;
    const dummy = new THREE.Object3D();
    // checkerboard tint for a clean designed look
    const colA = new THREE.Color(0x2c3c5c), colB = new THREE.Color(0x1e2a42);
    cells.forEach(([i, j], k) => {
      dummy.position.set(i * T, -1.5, j * T); dummy.updateMatrix();
      inst.setMatrixAt(k, dummy.matrix);
      inst.setColorAt(k, ((i + j) & 1) ? colA : colB);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.platMesh = inst; this.scene.add(inst);

    // glowing rim around each platform edge that borders a gap (neon outline)
    this._platRims(cells);
    this._scatterCoins(cells);
  }

  _platRims(cells) {
    if (this.rims) this.scene.remove(this.rims);
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x2fd0ff });
    const half = T * 0.47, thick = 0.25, hgt = 0.3;
    const edge = (i, j, ni, nj, horiz) => {
      if (this.solid.has(ni + ',' + nj)) return; // only rim edges facing a gap
      const m = new THREE.Mesh(new THREE.BoxGeometry(horiz ? T * 0.94 : thick, hgt, horiz ? thick : T * 0.94), mat);
      m.position.set(i * T + (horiz ? 0 : (nj - j) * 0 + (ni - i) * half), 0.15, j * T + (horiz ? (nj - j) * half : 0));
      g.add(m);
    };
    cells.forEach(([i, j]) => {
      edge(i, j, i, j + 1, true);   // +z edge
      edge(i, j, i, j - 1, true);   // -z edge
      edge(i, j, i + 1, j, false);  // +x edge
      edge(i, j, i - 1, j, false);  // -x edge
    });
    this.rims = g; this.scene.add(g);
  }

  _scatterCoins(cells) {
    const solidCells = cells.filter(([i, j]) => !(Math.abs(i) <= 1 && Math.abs(j) <= 1));
    for (const c of this.coins) c.alive = false, c.mesh.visible = false;
    for (const c of this.coins) {
      if (!solidCells.length) break;
      const [i, j] = solidCells[Math.floor(Math.random() * solidCells.length)];
      c.mesh.position.set(i * T + (Math.random() - 0.5) * T * 0.4, 1.2, j * T + (Math.random() - 0.5) * T * 0.4);
      c.alive = true; c.mesh.visible = true;
    }
  }

  isSolid(x, z) {
    const i = Math.round(x / T), j = Math.round(z / T);
    return this.solid.has(i + ',' + j);
  }

  _resetRun() {
    this.pos = new THREE.Vector3(0, 0, 0);   // x, y(height), z
    this.theta = 0;                          // heading
    this.vel = new THREE.Vector2(0, SPEED);  // horizontal velocity (x,z)
    this.vy = 0;                             // vertical velocity
    this.airborne = false;
    this.dead = false; this.deadT = 0; this.deathKind = '';
    this.heat = 0; this.burnT = 0;
    this.score = 0; this.dist = 0;
    this.pending = 0; this.driftTime = 0; this.mult = 1; this.notDrift = 0;
    this.camYaw = 0;
    for (const s of this.smoke) { s.life = 0; s.mesh.visible = false; }
    for (const f of this.flames) { f.life = 0; f.mesh.visible = false; }
    for (const t of this.trail) { t.life = 0; t.mesh.visible = false; }
    this.hud.setScore(0); this.hud.setHeat(0); this.hud.hideResult();
  }

  restart() { this._buildLevel(); this._resetRun(); this.running = true; }

  start() { this._resetRun(); this.running = true; this.clock.getDelta(); this._loop(); }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 1 / 30);
    try {
      if (this.running) this._update(dt);
      if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    } catch (e) { this.running = false; if (this.onError) this.onError(e); }
  }

  _update(dt) {
    if (this.dead) return this._updateDeath(dt);

    const steer = this.input.steer;

    // jump (only when grounded)
    if (this.input.jump && !this.airborne) { this.vy = JUMP_V; this.airborne = true; this.audio.jump(); }
    this.input.endFrame();

    // steer rotates heading; CONSTANT forward speed
    this.theta += steer * TURN * dt;
    const hx = Math.sin(this.theta), hz = Math.cos(this.theta);

    // velocity chases heading -> the lag IS the drift (front-led slide)
    const target = new THREE.Vector2(hx * SPEED, hz * SPEED);
    this.vel.lerp(target, clamp(GRIP * dt, 0, 1));
    if (this.vel.length() > 0.001) this.vel.setLength(SPEED); // keep speed constant

    // integrate horizontal
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;
    this.dist += SPEED * dt;

    // vertical / jump arc
    if (this.airborne) {
      this.vy -= GRAVITY * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) {
        this.pos.y = 0; this.airborne = false; this.vy = 0;
        if (this.isSolid(this.pos.x, this.pos.z)) this.audio.land();
        else return this._die('fall');           // landed in a gap
      }
    } else {
      // grounded: if we've rolled off a platform into a gap -> fall
      if (!this.isSolid(this.pos.x, this.pos.z)) return this._die('fall');
    }

    // --- drift / friction ---
    const moveAng = Math.atan2(this.vel.x, this.vel.y);
    let slip = Math.abs(moveAng - this.theta);
    if (slip > Math.PI) slip = Math.abs(slip - 2 * Math.PI);
    const slipDeg = slip * 180 / Math.PI;
    const drifting = !this.airborne && slipDeg > 7;
    const driftAmt = drifting ? clamp((slipDeg - 7) / 40, 0, 1) : 0;

    // friction heat builds while drifting, cools otherwise. smoke -> fire.
    this.heat = clamp(this.heat + (driftAmt * 0.9 - 0.45) * dt, 0, 1);
    this.woodMat.emissiveIntensity = this.heat > 0.6 ? (this.heat - 0.6) * 2.4 : 0;
    if (this.heat >= 0.999) { this.burnT += dt; if (this.burnT > 3) return this._die('burn'); }
    else this.burnT = Math.max(0, this.burnT - dt);

    // scoring: drift to build a combo that banks when you straighten
    if (drifting) {
      this.driftTime += dt; this.notDrift = 0;
      this.mult = clamp(1 + Math.floor(this.driftTime / 1.1), 1, 9);
      this.pending += SPEED * driftAmt * dt * 5;
      this.hud.setCombo(this.mult, Math.floor(this.pending * this.mult), true);
    } else if (this.pending > 0) {
      this.notDrift += dt; if (this.notDrift > 0.4) this._bank();
    }

    // coins
    for (const c of this.coins) {
      if (!c.alive) continue;
      c.mesh.rotation.z += dt * 3;
      const dx = c.mesh.position.x - this.pos.x, dz = c.mesh.position.z - this.pos.z;
      if (dx * dx + dz * dz < 2.2 * 2.2 && Math.abs(this.pos.y - 0.8) < 2) {
        c.alive = false; c.mesh.visible = false;
        this.score += 250; this.audio.point(3); this._shake(0.25);
      }
    }

    // lay a drift trail on the ground while sliding
    if (driftAmt > 0.1 && !this.airborne) {
      this.trailTimer += dt;
      if (this.trailTimer > 0.02) {
        this.trailTimer = 0;
        const t = this.trail[this.trailCursor]; this.trailCursor = (this.trailCursor + 1) % this.trail.length;
        t.mesh.position.set(this.pos.x, 0.06, this.pos.z);
        t.mesh.rotation.z = Math.atan2(this.vel.x, this.vel.y);
        t.mesh.scale.set(0.8 + driftAmt * 0.6, 2.4, 1);
        t.life = 1; t.mesh.visible = true;
        const warm = this.heat;  // trail glows warmer as it heats up
        t.mesh.material.color.setRGB(0.07 + warm * 0.5, 0.04 + warm * 0.06, 0.03);
      }
    }
    this._fadeTrail(dt);

    // emit smoke/fire from friction heat
    if (this.heat > 0.35) {
      this.smokeTimer = (this.smokeTimer || 0) + dt;
      if (this.smokeTimer > 0.03) { this.smokeTimer = 0; this._emitSmoke(this.heat); }
    }
    if (this.heat > 0.7) this._emitFlame(this.heat);
    this._updateSmoke(dt); this._updateFlames(dt);
    this.fireLight.position.set(this.pos.x, this.pos.y + 1.5, this.pos.z);
    this.fireLight.intensity = lerp(this.fireLight.intensity, this.heat > 0.7 ? (this.heat - 0.7) * 18 : 0, Math.min(1, dt * 8));

    // place cube + lean into the slide
    this.cube.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.cube.rotation.y = this.theta;
    const lean = clamp(-steer * driftAmt * 0.5, -0.4, 0.4);
    this.cube.rotation.z = lerp(this.cube.rotation.z, lean, Math.min(1, dt * 10));
    this.cube.rotation.x = lerp(this.cube.rotation.x, this.airborne ? -0.15 : 0, Math.min(1, dt * 8));
    // contact shadow shrinks/fades as the cube jumps
    this.blob.position.set(this.pos.x, 0.05, this.pos.z);
    const air = clamp(1 - this.pos.y / 6, 0.25, 1);
    this.blob.scale.setScalar(air); this.blob.material.opacity = 0.45 * air;

    this._updateCamera(dt, driftAmt);

    this.audio.roll01(0.5);
    this.audio.screech(driftAmt);
    this.audio.fire(this.heat > 0.7 ? (this.heat - 0.7) / 0.3 : 0);

    // score = banked drift/coins + distance survived (always ticking up)
    this.hud.setScore(this.score + Math.floor(this.dist));
    this.hud.setHeat(this.heat);
  }

  _updateCamera(dt, driftAmt) {
    this.shakeAmt = (this.shakeAmt || 0) * Math.pow(0.0001, dt);
    // smooth the camera yaw toward heading so it doesn't whip around
    let d = this.theta - this.camYaw;
    while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    this.camYaw += d * Math.min(1, dt * 3.5);
    const bx = Math.sin(this.camYaw), bz = Math.cos(this.camYaw);
    const sx = (Math.random() - 0.5) * this.shakeAmt, sz = (Math.random() - 0.5) * this.shakeAmt;
    const want = new THREE.Vector3(
      this.pos.x - bx * CAM_BACK + sx, CAM_H + this.pos.y * 0.5, this.pos.z - bz * CAM_BACK + sz);
    this.camPos.lerp(want, 1 - Math.exp(-dt * 6));
    this.camLook.lerp(new THREE.Vector3(this.pos.x + bx * 6, this.pos.y + 1.5, this.pos.z + bz * 6), 1 - Math.exp(-dt * 6));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    const wantFov = 55 + driftAmt * 8;
    this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, dt * 4);
    this.camera.updateProjectionMatrix();

    this.sun.position.set(this.pos.x + 10, 24, this.pos.z + 8);
    this.sun.target.position.set(this.pos.x, 0, this.pos.z);
    this.sun.target.updateMatrixWorld();
  }

  _shake(a) { this.shakeAmt = Math.min(2.5, (this.shakeAmt || 0) + a); }

  _die(kind) {
    if (this.dead) return;
    this.dead = true; this.deadT = 0; this.deathKind = kind;
    this.airborne = true; this.vy = kind === 'burn' ? 4 : -2; // burn pops up, fall drops
    if (this.pending > 0) this.score += Math.floor(this.pending * this.mult);
    this.score += Math.floor(this.dist);   // bank distance survived
    this.audio.hush();
    this.audio[kind === 'burn' ? 'ignite' : 'death']();
    this._shake(1.2);
  }

  _updateDeath(dt) {
    this.deadT += dt;
    // keep drifting horizontally while it falls/burns, for drama
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.y * dt;
    this.vy -= GRAVITY * dt; this.pos.y += this.vy * dt;
    this.cube.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.cube.rotation.x += dt * 4; this.cube.rotation.z += dt * 3;
    if (this.deathKind === 'burn') { for (let i = 0; i < 2; i++) this._emitFlame(1); }
    this._updateSmoke(dt); this._updateFlames(dt);
    this.fireLight.position.set(this.pos.x, this.pos.y + 1, this.pos.z);
    this._updateCamera(dt, 0);
    if (this.deadT > 0.9) this._finish();
  }

  _bank() {
    const gained = Math.floor(this.pending * this.mult);
    this.score += gained;
    this.audio.point(this.mult);
    this.hud.bankFlash(gained, this.mult);
    this._shake(0.15 + Math.min(this.mult, 9) * 0.05);
    this.pending = 0; this.driftTime = 0; this.mult = 1; this.notDrift = 0;
    this.hud.setCombo(1, 0, false);
  }

  _finish() {
    this.running = false;
    this.audio.hush();
    const isBest = this.score > this.best;
    if (isBest) { this.best = this.score; this._saveBest(this.best); this.hud.setBest(this.best); }
    this.hud.showResult(this.score, this.best, isBest, this.deathKind);
  }

  _fadeTrail(dt) {
    for (const t of this.trail) {
      if (t.life <= 0) continue;
      t.life -= dt * 0.22;
      t.mesh.material.opacity = Math.max(0, t.life) * 0.7;
      if (t.life <= 0) t.mesh.visible = false;
    }
  }

  _emitSmoke(amt) {
    const p = this.smoke[this.smokeCursor]; this.smokeCursor = (this.smokeCursor + 1) % this.smoke.length;
    p.mesh.position.set(this.pos.x, this.pos.y + 0.6, this.pos.z);
    p.size = 1.1; p.life = 1;
    p.vx = (Math.random() - 0.5) * 2 - this.vel.x * 0.15;
    p.vz = (Math.random() - 0.5) * 2 - this.vel.y * 0.15;
    p.vy = 2 + Math.random() * 2;
    const g = 0.3 + Math.random() * 0.2; p.mesh.material.color.setRGB(g, g, g);
    p.mesh.material.opacity = 0.5 * amt; p.mesh.visible = true;
  }
  _updateSmoke(dt) {
    for (const p of this.smoke) {
      if (p.life <= 0) continue;
      p.life -= dt * 0.8; p.size += dt * 3;
      p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
      p.mesh.scale.setScalar(p.size); p.mesh.quaternion.copy(this.camera.quaternion);
      p.mesh.material.opacity = Math.max(0, p.life) * 0.4;
      if (p.life <= 0) p.mesh.visible = false;
    }
  }

  _emitFlame(amt) {
    const p = this.flames[this.fireCursor]; this.fireCursor = (this.fireCursor + 1) % this.flames.length;
    p.mesh.position.set(this.pos.x + (Math.random() - 0.5) * 1.2, this.pos.y + 0.5, this.pos.z + (Math.random() - 0.5) * 1.2);
    p.size = 1.0 + Math.random() * 0.6; p.life = 1;
    p.vx = (Math.random() - 0.5) * 1.5; p.vz = (Math.random() - 0.5) * 1.5; p.vy = 4 + Math.random() * 3;
    p.mesh.material.color.setHSL(0.07 + Math.random() * 0.05, 1, 0.55);
    p.mesh.material.opacity = 0.9; p.mesh.visible = true;
  }
  _updateFlames(dt) {
    for (const p of this.flames) {
      if (p.life <= 0) continue;
      p.life -= dt * 2.4; p.size *= (1 - dt * 1.2);
      p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
      p.mesh.scale.setScalar(p.size); p.mesh.quaternion.copy(this.camera.quaternion);
      p.mesh.material.opacity = Math.max(0, p.life);
      if (p.life <= 0) p.mesh.visible = false;
    }
  }

  _loadBest() { try { return +localStorage.getItem('cube.best') || 0; } catch { return 0; } }
  _saveBest(v) { try { localStorage.setItem('cube.best', String(v)); } catch {} }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(w, h);
  }
}

// ---- procedural textures -------------------------------------------------
function makeWoodTexture() {
  const s = 128; const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, s);
  grd.addColorStop(0, '#9c6b35'); grd.addColorStop(0.5, '#b07d42'); grd.addColorStop(1, '#7e5328');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  // grain lines
  g.strokeStyle = 'rgba(80,50,20,0.35)'; g.lineWidth = 1;
  for (let y = 4; y < s; y += 7 + Math.random() * 4) {
    g.beginPath();
    for (let x = 0; x <= s; x += 8) g.lineTo(x, y + Math.sin(x * 0.15) * 2);
    g.stroke();
  }
  // a couple of knots
  for (let i = 0; i < 2; i++) {
    const kx = 20 + Math.random() * 88, ky = 20 + Math.random() * 88;
    g.strokeStyle = 'rgba(70,42,18,0.5)';
    for (let r = 2; r < 9; r += 2) { g.beginPath(); g.ellipse(kx, ky, r, r * 1.4, 0, 0, 7); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(cv); return t;
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

// platform top: subtle panel with a soft inner glow border
function makeTileTexture() {
  const s = 128; const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
  // inner panel
  g.fillStyle = '#cdd8ef'; g.fillRect(8, 8, s - 16, s - 16);
  // glowing inset border
  g.strokeStyle = 'rgba(90,160,255,0.9)'; g.lineWidth = 3;
  g.strokeRect(10, 10, s - 20, s - 20);
  // fine speckle
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(120,140,180,${0.05 + Math.random() * 0.12})`;
    g.fillRect(10 + Math.random() * (s - 20), 10 + Math.random() * (s - 20), 1.4, 1.4);
  }
  return new THREE.CanvasTexture(cv);
}
