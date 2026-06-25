import * as THREE from 'three';
import { Ragdoll } from './physics.js?v=25';
// Bloom is loaded dynamically below so a missing addon can't block startup.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// === STICK!  — launch a little active-ragdoll guy, flip, and STICK the landing.
// One button does everything:
//   on the ground, HOLD to wind up the launch (angle sweeps), RELEASE to fire.
//   in the air, HOLD to TUCK (relax muscles + curl = spin faster), RELEASE to
//     open up; land feet-first while open => muscles CATCH it => you STICK and
//     keep your momentum + a combo boost, then run on. Land on your head/back =>
//     comedy faceplant, run ends. Distance is the score.
const LAUNCH_MIN = 11, LAUNCH_MAX = 23;   // launch speed range from the wind-up
const WIND_RATE = 1.3;                     // how fast the power meter fills
const TUCK_SPIN = 7.5;                      // rad/s of spin added while tucking
const STICK_BOOST = 1.18;                   // momentum kept+ when you stick a landing
const GRAV_FEEL = 1.0;

export class Game {
  constructor(canvas, audio, input, hud) {
    this.audio = audio; this.input = input; this.hud = hud;
    this.onError = null;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xbfe0e8, 60, 220);
    this.scene.background = new THREE.Color(0xbfe0e8);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 600);

    this._sky();
    this._lights();
    this.env = this._makeEnv();
    this.ragdoll = new Ragdoll();
    this._buildRagdollMesh();
    this._world();
    this._fx();
    this._post();

    this.best = this._loadBest();
    this._reset();
    this.running = false;
    this.hud.setBest(this.best);

    this.clock = new THREE.Clock();
    addEventListener('resize', () => this._resize());
    this._resize();
  }

  _sky() {
    const geo = new THREE.SphereGeometry(420, 32, 16);
    const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x4a86c8) }, bot: { value: new THREE.Color(0xdaf0f4) } },
      vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 bot;
        void main(){ float h=normalize(vP).y*0.5+0.5; gl_FragColor=vec4(mix(bot,top,smoothstep(0.0,1.0,h)),1.0);}` });
    this.scene.add(new THREE.Mesh(geo, mat));
    // a few soft clouds for parallax/charm
    this.clouds = new THREE.Group();
    const cmat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 7; i++) {
      const c = new THREE.Mesh(new THREE.SphereGeometry(2 + Math.random() * 2.5, 10, 8), cmat);
      c.position.set(20 + i * 30 + Math.random() * 20, 16 + Math.random() * 14, -14 - Math.random() * 20);
      c.scale.set(1.8, 0.7, 1); this.clouds.add(c);
    }
    this.scene.add(this.clouds);
  }

  _lights() {
    this.scene.add(new THREE.HemisphereLight(0xdff0ff, 0x6a7a55, 0.9));
    const sun = new THREE.DirectionalLight(0xfff4e2, 2.1);
    sun.position.set(-10, 22, 10); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 16; Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 70 });
    sun.shadow.bias = -0.0004; sun.shadow.radius = 5;
    this.scene.add(sun); this.scene.add(sun.target); this.sun = sun;
  }

  // endless flat-ish ground at y=0; distance markers scroll past for speed read
  _makeEnv() { return { kind: 'flat', boxes: [], groundY() { return 0; } }; }

  _world() {
    // long striped runway ground
    const tex = makeGroundTex();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(120, 6);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 80),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.receiveShadow = true; this.scene.add(this.ground);
    // a launch ramp at the start
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 4),
      new THREE.MeshStandardMaterial({ color: 0x3b4a66, roughness: 0.7, metalness: 0.2, emissive: 0x16203a, emissiveIntensity: 0.4 }));
    ramp.position.set(-1.6, 0.8, 0); ramp.castShadow = ramp.receiveShadow = true; this.scene.add(ramp);
    // distance flags every 10m
    this.flags = [];
    for (let i = 1; i <= 30; i++) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshStandardMaterial({ color: i % 5 === 0 ? 0xffd23a : 0xff6b6b, side: THREE.DoubleSide }));
      flag.position.set(0.45, 0.8, 0);
      const g = new THREE.Group(); g.add(pole); pole.position.y = 1.1; g.add(flag);
      g.position.set(i * 10, 0, -3.5); this.scene.add(g); this.flags.push(g);
    }
  }

  _buildRagdollMesh() {
    this.skin = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffc24d, roughness: 0.4, metalness: 0.05 });
    this.skinMat = mat;
    this.jointMeshes = {};
    const jr = (n, r) => ({ head: 0.22, neck: 0.10, chest: 0.07, spine: 0.07, pelvis: 0.11 }[n] ?? r * 0.95);
    for (const p of this.ragdoll.P) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(jr(p.name, p.r), 16, 12), mat);
      m.castShadow = true; this.skin.add(m); this.jointMeshes[p.name] = m;
    }
    const head = this.jointMeshes['head'];
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x14202e, roughness: 0.35 });
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), eyeMat); e.position.set(sx * 0.08, 0.04, 0.19); head.add(e); }
    // a cheeky smile
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 6, 12, Math.PI), eyeMat);
    mouth.position.set(0, -0.04, 0.2); mouth.rotation.z = Math.PI; head.add(mouth);
    const TORSO = new Set(['pelvis-spine', 'spine-chest', 'chest-pelvis', 'chest-hipL', 'chest-hipR', 'pelvis-hipL', 'pelvis-hipR', 'hipL-hipR', 'shL-shR']);
    this.boneMeshes = this.ragdoll.bones.map((c) => {
      const key = c.a.name + '-' + c.b.name;
      const thick = TORSO.has(key) ? 0.14 : (key.includes('head') || key.includes('neck')) ? 0.09 : 0.08;
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(thick, 1, 4, 10), mat); m.castShadow = true; m.userData.thick = thick;
      this.skin.add(m); return m;
    });
    this.scene.add(this.skin);
    this._up = new THREE.Vector3(0, 1, 0);
  }

  _fx() {
    const tex = makePuff();
    this.fx = [];
    for (let i = 0; i < 36; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; this.scene.add(m); this.fx.push({ mesh: m, life: 0, v: new THREE.Vector3() });
    }
    this.fxCursor = 0;
    // motion trail ribbon (a fading line of the pelvis path)
    this.trailPts = []; this.trailMax = 40;
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.trailMax * 3), 3));
    this.trail = new THREE.Line(this.trailGeo, new THREE.LineBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.6 }));
    this.trail.frustumCulled = false; this.scene.add(this.trail);
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
      c.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.6, 0.9));
      c.setSize(innerWidth, innerHeight); this.composer = c;
    } catch (e) { this.composer = null; }
  }

  // ---------------------------------------------------------------- state --
  _reset() {
    this.ragdoll.reset(new THREE.Vector3(0, 0, 0));
    this.ragdoll.muscleScale = 1;
    this.phase = 'ready';            // ready -> winding -> flying -> landed/dead
    this.power = 0; this.windDir = 1;
    this.dist = 0; this.bestDist = 0; this.combo = 0; this.sticks = 0;
    this.over = false; this.overT = 0; this._shownResult = false;
    this.slowmo = 1; this.shakeAmt = 0; this.spin = 0;
    this.airTime = 0; this.tucking = false; this.launched = false;
    this.trailPts.length = 0;
    for (const f of this.fx) { f.life = 0; f.mesh.visible = false; }
    this.camX = 0;
    this.hud.setDist(0); this.hud.setCombo(0); this.hud.setPower(0); this.hud.hideResult();
    this.hud.setPhase('ready');
  }

  start() { this._reset(); this.running = true; this.clock.getDelta(); this._loop(); }
  restart() { this._reset(); this.running = true; }

  _loop() {
    requestAnimationFrame(() => this._loop());
    let dt = Math.min(this.clock.getDelta(), 1 / 60);
    try {
      if (this.running) this._update(dt);
      this._render(dt);
      if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    } catch (e) { this.running = false; if (this.onError) this.onError(e); }
  }

  _pelvisVel() {
    const p = this.ragdoll.byName['pelvis'];
    return new THREE.Vector3(p.pos.x - p.prev.x, p.pos.y - p.prev.y, p.pos.z - p.prev.z);
  }

  _update(dt) {
    // ease slow-mo back to normal
    this.slowmo = lerp(this.slowmo, 1, Math.min(1, dt * 3));
    const sdt = dt * this.slowmo;

    const held = this.input.held, pressed = this.input.pressed, released = this.input.released;
    this.input.endFrame();

    if (this.phase === 'ready') {
      if (pressed) { this.phase = 'winding'; this.power = 0.001; this.windDir = 1; }
    } else if (this.phase === 'winding') {
      // power meter ping-pongs; release fires at the current power
      this.power = clamp(this.power + this.windDir * WIND_RATE * dt, 0, 1);
      if (this.power >= 1) this.windDir = -1; else if (this.power <= 0.05 && this.windDir < 0) this.windDir = 1;
      this.hud.setPower(this.power);
      this.audio.wind(this.power);
      if (released) this._launch();
    } else if (this.phase === 'flying') {
      this.airTime += sdt;
      // TUCK while held: relax muscles (so it curls freely) + add forward spin
      this.tucking = held;
      this.ragdoll.muscleScale = held ? 0.0 : 1.0;   // open up (re-engage) on release => catch the landing
      if (held) this._addSpin(TUCK_SPIN * sdt);
      else this._landingAssist(sdt);                 // open + falling => actively right toward feet-down (skill-scaled)
      this.audio.tuck(held && this.spin !== 0 ? 1 : 0);
      // accumulate body rotation (head-relative-to-pelvis angle) for a flip bonus
      const hd = this.ragdoll.byName['head'].pos, pl = this.ragdoll.byName['pelvis'].pos;
      const ang = Math.atan2(hd.y - pl.y, hd.x - pl.x);
      if (this._lastBodyAng !== null) {
        let da = ang - this._lastBodyAng;
        while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        this.flipAccum += Math.abs(da);
      }
      this._lastBodyAng = ang;
    } else if (this.phase === 'landed') {
      // brief beat to read the STICK, then bound back into the air for the chain
      this.landTimer = (this.landTimer || 0) + dt;
      if (this.landTimer > 0.16 && !this.over) { this.phase = 'flying'; this.airTime = 0; this.hud.setPhase('flying'); }
    }

    // physics substeps (skip while purely 'ready'/'winding' so it stands calm)
    if (this.phase === 'flying' || this.phase === 'landed' || this.phase === 'dead') {
      for (let s = 0; s < 2; s++) this.ragdoll.step(sdt / 2, this.env);
    } else {
      for (let s = 0; s < 2; s++) this.ragdoll.step(dt / 2, this.env);
    }

    if (this.phase === 'flying') this._checkLanding(dt);

    // distance = how far the pelvis has travelled in +x
    const px = this.ragdoll.byName['pelvis'].pos.x;
    this.dist = Math.max(this.dist, px);
    if (this.phase === 'flying' || this.phase === 'landed') {
      this.hud.setDist(Math.floor(this.dist));
      if (this.dist > this.best) { this.best = Math.floor(this.dist); this._saveBest(this.best); this.hud.setBest(this.best); }
    }

    this._stepFx(sdt);
    if (this.over) { this.overT += dt; if (this.overT > 1.1 && !this._shownResult) { this._shownResult = true; this._finish(); } }
  }

  _launch() {
    const speed = lerp(LAUNCH_MIN, LAUNCH_MAX, this.power);
    const ang = 0.92;   // ~53° launch
    const vx = Math.cos(ang) * speed, vy = Math.sin(ang) * speed;
    // give every particle the launch velocity (whole body leaves the ramp)
    for (const p of this.ragdoll.P) {
      p.prev.x = p.pos.x - vx * (1 / 120);
      p.prev.y = p.pos.y - vy * (1 / 120);
    }
    this.phase = 'flying'; this.launched = true; this.airTime = 0; this.power = 0;
    this.runSpeed = speed;                              // authoritative run speed (escalates per clean stick)
    this.flipAccum = 0; this._lastBodyAng = null;       // track rotations this flight
    this.hud.setPower(0); this.hud.setPhase('flying');
    this.audio.launch(); this._shake(0.3); this._burst(this.ragdoll.byName['pelvis'].pos, 0xffffff, 12);
  }

  // add a forward-flip rotational impulse around the CoM (verified in headless
  // gameloop test: this sign yields a true forward somersault, ~4 flips/throw)
  _addSpin(amount) {
    const com = this.ragdoll.com();
    for (const p of this.ragdoll.P) {
      const ry = p.pos.y - com.y, rx = p.pos.x - com.x;
      p.prev.x += amount * ry;           // shift prev opposite to the added velocity
      p.prev.y += -amount * rx;
    }
    this.spin += amount;
  }

  // body verticality: +1 = head straight up over feet (upright), 0 = sideways,
  // -1 = inverted. Pure function of the player's flip timing — what they control.
  _verticality() {
    const ftL = this.ragdoll.byName['ftL'].pos, ftR = this.ragdoll.byName['ftR'].pos, hp = this.ragdoll.byName['head'].pos;
    const ax = hp.x - (ftL.x + ftR.x) * 0.5, ay = hp.y - (ftL.y + ftR.y) * 0.5, az = hp.z - (ftL.z + ftR.z) * 0.5;
    const L = Math.hypot(ax, ay, az) || 1;
    return ay / L;
  }

  // While OPEN (released) and airborne, actively rotate toward feet-down — but
  // the assist's AUTHORITY scales with how upright you already are. Release
  // near-upright => it cleanly finishes the rotation (forgiving, learnable).
  // Release while inverted/sideways => it can't save you => you flop. THIS is
  // what makes the tuck-release a fair, learnable skill instead of luck.
  _landingAssist(dt) {
    if (this.airTime < 0.12) return;
    const vert = this._verticality();
    if (vert > 0.97) return;
    const authority = clamp((vert + 0.85) / 1.3, 0, 1);   // forgiving: strong help unless badly inverted
    if (authority <= 0.02) return;
    const w = (1 - vert) * 15 * authority * dt;           // proportional righting torque (about z, x-y plane)
    const com = this.ragdoll.com();
    const dirSign = (this.ragdoll.byName['head'].pos.x - com.x) >= 0 ? 1 : -1;
    for (const p of this.ragdoll.P) {
      const rx = p.pos.x - com.x, ry = p.pos.y - com.y;
      p.prev.x += -w * ry * dirSign;   // shift prev opposite the velocity we add (Verlet)
      p.prev.y += w * rx * dirSign;
    }
  }

  _checkLanding(dt) {
    const ftL = this.ragdoll.byName['ftL'].pos, ftR = this.ragdoll.byName['ftR'].pos;
    const head = this.ragdoll.byName['head'].pos.y, pelY = this.ragdoll.byName['pelvis'].pos.y;
    const ft = (ftL.y + ftR.y) * 0.5;
    // contact = feet OR pelvis near the ground (the parts that bear a landing).
    // Using feet+pelvis (not every particle) avoids a dangling arm triggering a
    // false early landing, while still catching a body-first impact.
    const lowest = Math.min(ft, pelY);
    if (this.airTime < 0.22 || lowest > 0.32) return;

    // quality from verticality at impact (timing-driven) × softness
    const vert = this._verticality();
    const uprightQ = clamp(vert, 0, 1);
    const vy = this._pelvisVel().y;
    const softQ = clamp(1 + vy / 0.6, 0, 1);
    const landQ = uprightQ * (0.55 + 0.45 * softQ);
    // still tucking at impact, or clearly not upright => FLOP (the fail state).
    // threshold eases the first few sticks (onboarding ramp) then tightens, so
    // newcomers reliably get going and learn the rhythm before difficulty bites.
    const failGate = this.sticks < 3 ? 0.12 : 0.3;
    if (this.tucking || uprightQ < failGate || head < pelY + 0.05) return this._die();

    // STICK!
    this.phase = 'landed'; this.landTimer = 0;
    this.sticks++; this.combo++;
    let tier = 'STICK';
    if (landQ > 0.85) tier = 'PERFECT'; else if (landQ > 0.62) tier = 'CLEAN';
    this.lastTier = tier;
    // ESCALATING run speed (authoritative; survives landing damping). A clean
    // stick speeds you up, a scrappy one barely; faster => flatter arc => the
    // timing window tightens. This is the rising difficulty curve.
    const add = landQ > 0.78 ? 1.7 : landQ > 0.6 ? 0.8 : 0.2;
    this.runSpeed = clamp((this.runSpeed || 14) + add, 10, 40);
    const hopAng = 0.66 - clamp((this.runSpeed - 15) * 0.012, 0, 0.30);
    const nvx = Math.cos(hopAng) * this.runSpeed, nvy = Math.sin(hopAng) * this.runSpeed;
    for (const p of this.ragdoll.P) { p.prev.x = p.pos.x - nvx * (1 / 120); p.prev.y = p.pos.y - nvy * (1 / 120); }
    // flip bonus + quality bonus
    const flips = Math.floor(this.flipAccum / (Math.PI * 2));
    if (flips >= 1) { this.dist += flips * 8 * (tier === 'PERFECT' ? 1.6 : 1); this.hud.flash(flips + (flips > 1 ? ' FLIPS!' : ' FLIP!')); }
    this.flipAccum = 0; this._lastBodyAng = null;
    this.dist += Math.round(landQ * 4 + (tier === 'PERFECT' ? 6 : 0));
    this.audio.stick(this.combo + flips + (tier === 'PERFECT' ? 4 : 0));
    this._burst(ftL, tier === 'PERFECT' ? 0x6affd0 : 0xffd23a, tier === 'PERFECT' ? 26 : 16);
    this._shake(0.28 + landQ * 0.2); this.slowmo = tier === 'PERFECT' ? 0.28 : 0.42;
    const label = tier + (this.combo > 1 ? ' ×' + this.combo : '') + (tier === 'PERFECT' ? '!' : '');
    this.hud.flash(label); this.hud.setCombo(this.combo); this.hud.setPhase('landed');
  }

  _die() {
    if (this.over) return;
    this.phase = 'dead'; this.over = true; this.overT = 0;
    this.ragdoll.muscleScale = 0;          // go fully limp for the flop
    this.ragdoll.consciousness = 0;
    this.audio.flop(); this._shake(0.6); this.slowmo = 0.4;
    this.hud.flash('FLOP!'); this.hud.setPhase('dead');
  }

  _finish() {
    this.running = false;
    const score = Math.floor(this.dist);
    const isBest = score >= this.best;
    this.hud.showResult(score, this.best, isBest, this.sticks, this.combo);
  }

  // ---------------------------------------------------------------- render --
  _render(dt) {
    for (const p of this.ragdoll.P) this.jointMeshes[p.name].position.copy(p.pos);
    for (let i = 0; i < this.ragdoll.bones.length; i++) {
      const c = this.ragdoll.bones[i], m = this.boneMeshes[i];
      const a = c.a.pos, b = c.b.pos;
      m.position.copy(a).add(b).multiplyScalar(0.5);
      const d = b.clone().sub(a); const len = d.length();
      m.scale.set(1, Math.max(0.02, len - 2 * (m.userData.thick || 0.08)), 1);
      m.quaternion.setFromUnitVectors(this._up, d.normalize());
    }
    // tint slightly red on a flop
    const c01 = this.ragdoll.consciousness;
    this.skinMat.color.setRGB(lerp(0.95, 1.0, c01), lerp(0.45, 0.76, c01), lerp(0.2, 0.3, c01));

    // motion trail from the pelvis while airborne
    const pv = this.ragdoll.byName['pelvis'].pos;
    if (this.phase === 'flying') {
      this.trailPts.push(pv.x, pv.y, pv.z);
      if (this.trailPts.length > this.trailMax * 3) this.trailPts.splice(0, 3);
      const arr = this.trailGeo.attributes.position.array;
      for (let i = 0; i < this.trailMax * 3; i++) arr[i] = this.trailPts[i] ?? pv.getComponent ? 0 : 0;
      for (let i = 0; i < this.trailPts.length; i++) arr[i] = this.trailPts[i];
      this.trailGeo.setDrawRange(0, Math.floor(this.trailPts.length / 3));
      this.trailGeo.attributes.position.needsUpdate = true;
      this.trail.visible = true;
    } else this.trail.visible = false;

    this._stepFxRender();

    // camera: side-on chase that follows the guy down the runway
    const sh = this.shakeAmt; this.shakeAmt *= Math.pow(0.0001, dt);
    const com = this.ragdoll.com();
    this.camX = lerp(this.camX, com.x, 1 - Math.exp(-dt * 4));
    const camTargetY = clamp(com.y * 0.5 + 2.2, 2.2, 7);
    this.camera.position.set(this.camX - 1.5 + (Math.random() - 0.5) * sh, camTargetY + (Math.random() - 0.5) * sh, 13);
    this.camera.lookAt(this.camX + 2, clamp(com.y * 0.4 + 1.4, 1.4, 5), 0);

    this.sun.position.set(this.camX - 10, 22, 10); this.sun.target.position.set(this.camX, 0, 0); this.sun.target.updateMatrixWorld();
    this.ground.position.x = this.camX;
    this.ground.material.map.offset.x = this.camX * 0.0125;
    this.clouds.position.x = this.camX * 0.4;
  }

  _burst(pos, color, n) {
    const col = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const f = this.fx[this.fxCursor]; this.fxCursor = (this.fxCursor + 1) % this.fx.length;
      f.mesh.position.copy(pos);
      f.v.set((Math.random() - 0.5) * 7, Math.random() * 5 + 1, (Math.random() - 0.5) * 7);
      f.life = 1; f.mesh.material.color.copy(col); f.mesh.material.opacity = 1; f.mesh.scale.setScalar(0.2 + Math.random() * 0.4); f.mesh.visible = true;
    }
  }
  _stepFx(dt) { for (const f of this.fx) { if (f.life <= 0) continue; f.life -= dt * 2; f.v.y -= 14 * dt; f.mesh.position.addScaledVector(f.v, dt); } }
  _stepFxRender() { for (const f of this.fx) { if (f.life <= 0) { if (f.mesh.visible) f.mesh.visible = false; continue; } f.mesh.quaternion.copy(this.camera.quaternion); f.mesh.material.opacity = Math.max(0, f.life); } }

  _shake(a) { this.shakeAmt = Math.min(1.4, this.shakeAmt + a); }
  _loadBest() { try { return +localStorage.getItem('stick.best') || 0; } catch { return 0; } }
  _saveBest(v) { try { localStorage.setItem('stick.best', String(v)); } catch {} }
  _resize() { const w = innerWidth, h = innerHeight; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); if (this.composer) this.composer.setSize(w, h); }
}

function makeGroundTex() {
  const s = 128; const cv = document.createElement('canvas'); cv.width = cv.height = s; const g = cv.getContext('2d');
  g.fillStyle = '#7fae5a'; g.fillRect(0, 0, s, s);
  g.fillStyle = '#76a352'; for (let i = 0; i < s; i += 16) g.fillRect(i, 0, 8, s);
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, s - 6, s, 3);
  return new THREE.CanvasTexture(cv);
}
function makePuff() {
  const s = 64; const cv = document.createElement('canvas'); cv.width = cv.height = s; const g = cv.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s); return new THREE.CanvasTexture(cv);
}
