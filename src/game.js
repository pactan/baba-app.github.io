import * as THREE from 'three';
// Bloom is loaded dynamically below so a missing addon can't block startup.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// --- tuning ---------------------------------------------------------------
const H = 1.0;             // height of each block layer
const BASE = 9;            // starting block footprint (x & z)
const START_SPEED = 9;     // sliding speed of a fresh block
const SPEED_STEP = 0.28;   // +speed per layer (gets harder)
const MAX_SPEED = 26;
const MOVE_RANGE = 13;     // how far a block slides out to either side
const PERFECT_EPS = 0.55;  // overlap error under this = "perfect" (no cut)
const PERFECT_REGROW = 0.6;// reward: perfect placements grow the block back
const CAM_RISE = 1.0;      // camera follows the tower up by H per layer

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
    this.scene.fog = new THREE.Fog(0x0a0e1c, 60, 150);
    this._sky();

    // orthographic-ish perspective from a fixed iso angle (classic Stack look)
    const aspect = 1;
    this.camera = new THREE.PerspectiveCamera(32, aspect, 0.1, 600);
    this.camOff = new THREE.Vector3(46, 40, 46);   // iso offset (pulled back to frame the tower)
    this.camLookY = 0; this.camTargetY = 0;

    this._lights();
    this._ground();
    this._fragments();
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
    const geo = new THREE.SphereGeometry(400, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x0b1338) }, bot: { value: new THREE.Color(0x241a44) } },
      vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 bot;
        void main(){ float h=normalize(vP).y*0.5+0.5; gl_FragColor=vec4(mix(bot,top,smoothstep(0.0,1.0,h)),1.0);}`,
    });
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  _lights() {
    this.scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x10121f, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(18, 30, 12); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 120;
    const d = 30; Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
    sun.shadow.bias = -0.0004; sun.shadow.radius = 5;
    this.scene.add(sun); this.scene.add(sun.target);
    this.sun = sun;
  }

  _ground() {
    // a tall pedestal the tower grows from
    this.pedestal = new THREE.Mesh(
      new THREE.BoxGeometry(BASE, 40, BASE),
      new THREE.MeshStandardMaterial({ color: 0x121830, roughness: 0.6, metalness: 0.1 }));
    this.pedestal.position.y = -20; this.pedestal.receiveShadow = true; this.pedestal.castShadow = true;
    this.scene.add(this.pedestal);
  }

  // pool of falling offcut pieces (the chopped slices that tumble away)
  _fragments() {
    this.frags = [];
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, H, 1), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      m.castShadow = true; m.visible = false; this.scene.add(m);
      this.frags.push({ mesh: m, life: 0, vy: 0, vx: 0, vz: 0, spin: 0, axis: 'x' });
    }
    this.fragCursor = 0;
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
      c.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.5, 0.9));
      c.setSize(innerWidth, innerHeight);
      this.composer = c;
    } catch (e) { this.composer = null; }
  }

  // ---------------------------------------------------------------- state --
  _reset() {
    // clear any existing stacked blocks
    if (this.stack) for (const b of this.stack) this.scene.remove(b.mesh);
    for (const f of this.frags) { f.life = 0; f.mesh.visible = false; }
    this.stack = [];
    this.score = 0; this.perfectCombo = 0;
    this.hue = Math.random();
    this.over = false; this.overT = 0; this._shownResult = false;
    this.camLookY = 0; this.camTargetY = 0;

    // base block sitting on the pedestal
    const base = this._makeBlock(BASE, BASE, 0);
    base.mesh.position.set(0, 0, 0);
    this.stack.push(base);

    this.moveAxis = 'x';
    this._spawnMoving();
    this.hud.setScore(0);
    this.hud.hideResult();
  }

  _color(layer) {
    // smooth rainbow gradient climbing the tower
    const c = new THREE.Color();
    c.setHSL((this.hue + layer * 0.035) % 1, 0.55, 0.55);
    return c;
  }

  _makeBlock(sx, sz, layer) {
    const geo = new THREE.BoxGeometry(sx, H, sz);
    const mat = new THREE.MeshStandardMaterial({ color: this._color(layer), roughness: 0.5, metalness: 0.05 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);
    return { mesh, sx, sz, layer };
  }

  // spawn the next sliding block on top, matching the top block's size
  _spawnMoving() {
    const top = this.stack[this.stack.length - 1];
    const layer = this.stack.length;
    const b = this._makeBlock(top.sx, top.sz, layer);
    const y = layer * H;
    this.moveAxis = (layer % 2 === 1) ? 'x' : 'z';   // alternate slide direction
    const dir = (layer % 2 === 1) ? -1 : 1;
    b.mesh.position.set(top.mesh.position.x, y, top.mesh.position.z);
    if (this.moveAxis === 'x') b.mesh.position.x = top.mesh.position.x - dir * MOVE_RANGE;
    else b.mesh.position.z = top.mesh.position.z - dir * MOVE_RANGE;
    b.dir = dir;
    b.speed = clamp(START_SPEED + layer * SPEED_STEP, START_SPEED, MAX_SPEED);
    this.moving = b;
    this.camTargetY = layer * H;   // camera rises with the tower
  }

  start() { this._reset(); this.running = true; this.clock.getDelta(); this._loop(); }
  restart() { this._reset(); this.running = true; }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 1 / 30);
    try {
      if (this.running) this._update(dt);
      this._updateFragments(dt);
      this._updateCamera(dt);
      if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    } catch (e) { this.running = false; if (this.onError) this.onError(e); }
  }

  _update(dt) {
    if (this.over) { this.overT += dt; if (this.overT > 0.6 && !this._shownResult) { this._shownResult = true; this._finish(); } return; }

    const m = this.moving;
    // slide back and forth along the active axis
    const ax = this.moveAxis;
    m.mesh.position[ax] += m.dir * m.speed * dt;
    if (m.mesh.position[ax] > MOVE_RANGE) { m.mesh.position[ax] = MOVE_RANGE; m.dir = -1; }
    if (m.mesh.position[ax] < -MOVE_RANGE) { m.mesh.position[ax] = -MOVE_RANGE; m.dir = 1; }

    if (this.input.tapped) { this.input.endFrame(); this._drop(); }
  }

  // the tap: cut the moving block against the one below it
  _drop() {
    const top = this.stack[this.stack.length - 1];
    const m = this.moving;
    const ax = this.moveAxis;
    const sizeKey = ax === 'x' ? 'sx' : 'sz';

    const delta = m.mesh.position[ax] - top.mesh.position[ax];
    const overlap = top[sizeKey] - Math.abs(delta);

    if (overlap <= 0) {
      // total miss -> the whole block falls, game over
      this._spawnFragment(m.mesh.position[ax], m[sizeKey] || m.sx, ax, m, true);
      m.mesh.visible = false;
      this.over = true; this.overT = 0;
      this.audio.over();
      this._shake(1.0);
      return;
    }

    let newSize = overlap;
    let center = top.mesh.position[ax] + delta / 2;

    if (Math.abs(delta) <= PERFECT_EPS) {
      // PERFECT: snap exactly on top, no cut, and grow back a little as a reward
      this.perfectCombo++;
      newSize = Math.min(BASE, top[sizeKey] + PERFECT_REGROW);
      center = top.mesh.position[ax];
      this.audio.perfect(this.perfectCombo);
      this._flashPerfect(m, center);
    } else {
      // normal cut: spawn the offcut as a falling fragment
      this.perfectCombo = 0;
      const cutCenter = m.mesh.position[ax] + (delta > 0 ? 1 : -1) * (overlap / 2 + Math.abs(delta) / 2);
      this._spawnFragment(cutCenter, Math.abs(delta), ax, m, false);
      this.audio.place(this.stack.length);
    }

    // resize the moving block to the overlap and lock it in
    const finalSx = ax === 'x' ? newSize : m.sx;
    const finalSz = ax === 'z' ? newSize : m.sz;
    m.mesh.geometry.dispose();
    m.mesh.geometry = new THREE.BoxGeometry(finalSx, H, finalSz);
    m.mesh.position[ax] = center;
    m.sx = finalSx; m.sz = finalSz;
    this.stack.push(m);

    this.score++;
    this.hud.setScore(this.score);
    if (this.score > this.best) { this.best = this.score; this._saveBest(this.best); this.hud.setBest(this.best); }

    this._spawnMoving();
  }

  // a chopped slice that tumbles off the tower
  _spawnFragment(centerOnAxis, size, ax, srcBlock, whole) {
    const f = this.frags[this.fragCursor]; this.fragCursor = (this.fragCursor + 1) % this.frags.length;
    const sx = whole ? srcBlock.sx : (ax === 'x' ? size : srcBlock.sx);
    const sz = whole ? srcBlock.sz : (ax === 'z' ? size : srcBlock.sz);
    f.mesh.geometry.dispose();
    f.mesh.geometry = new THREE.BoxGeometry(Math.max(0.1, sx), H, Math.max(0.1, sz));
    f.mesh.material.color.copy(srcBlock.mesh.material.color);
    const pos = srcBlock.mesh.position.clone();
    pos[ax] = centerOnAxis;
    f.mesh.position.copy(pos);
    f.mesh.rotation.set(0, 0, 0);
    f.mesh.visible = true; f.life = 1;
    f.vy = 1.5; f.vx = ax === 'x' ? (centerOnAxis - srcBlock.mesh.position[ax] >= 0 ? 4 : -4) : (Math.random() - 0.5) * 2;
    f.vz = ax === 'z' ? (centerOnAxis - srcBlock.mesh.position[ax] >= 0 ? 4 : -4) : (Math.random() - 0.5) * 2;
    if (whole) { f.vx = (Math.random() - 0.5) * 3; f.vz = (Math.random() - 0.5) * 3; f.vy = 2; }
    f.spin = (Math.random() - 0.5) * 6; f.axis = ax;
    this.audio.slice();
  }

  _updateFragments(dt) {
    for (const f of this.frags) {
      if (f.life <= 0) continue;
      f.life -= dt * 0.5;
      f.vy -= 22 * dt;
      f.mesh.position.x += f.vx * dt; f.mesh.position.y += f.vy * dt; f.mesh.position.z += f.vz * dt;
      f.mesh.rotation.x += f.spin * dt; f.mesh.rotation.z += f.spin * 0.7 * dt;
      if (f.life <= 0) f.mesh.visible = false;
    }
  }

  _flashPerfect(block, center) {
    // a quick expanding ring on a perfect hit
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.5, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(block.mesh.position.x, block.mesh.position.y + H / 2 + 0.02, block.mesh.position.z);
    this.scene.add(ring);
    const t0 = performance.now();
    const anim = () => {
      const k = (performance.now() - t0) / 350;
      if (k >= 1) { this.scene.remove(ring); ring.geometry.dispose(); return; }
      ring.scale.setScalar(1 + k * 7);
      ring.material.opacity = 0.9 * (1 - k);
      requestAnimationFrame(anim);
    };
    anim();
    this._shake(0.12);
  }

  _updateCamera(dt) {
    this.camLookY = lerp(this.camLookY, this.camTargetY, 1 - Math.exp(-dt * 4));
    const sh = this.shakeAmt || 0;
    this.shakeAmt = sh * Math.pow(0.0001, dt);
    // look a few units below the active block so the tower has headroom on screen
    const look = new THREE.Vector3(0, this.camLookY - 4, 0);
    const p = look.clone().add(this.camOff);
    p.x += (Math.random() - 0.5) * sh; p.y += (Math.random() - 0.5) * sh;
    this.camera.position.lerp(p, 1 - Math.exp(-dt * 5));
    this.camera.lookAt(look);
    this.sun.target.position.set(0, this.camLookY, 0); this.sun.target.updateMatrixWorld();
    this.sun.position.set(18, this.camLookY + 30, 12);
  }

  _shake(a) { this.shakeAmt = Math.min(2, (this.shakeAmt || 0) + a); }

  _finish() {
    this.running = false;
    const isBest = this.score >= this.best && this.score > 0;
    this.hud.showResult(this.score, this.best, isBest);
  }

  _loadBest() { try { return +localStorage.getItem('stack.best') || 0; } catch { return 0; } }
  _saveBest(v) { try { localStorage.setItem('stack.best', String(v)); } catch {} }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(w, h);
  }
}
