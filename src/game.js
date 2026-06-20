import * as THREE from 'three';
// Bloom is loaded dynamically below so a missing addon can't block startup.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// === SWING · STACK =========================================================
// A 50/50 fusion. STACK's tower-building + slicing IS the goal; but the next
// block doesn't slide linearly — it HANGS ON A ROPE and SWINGS (SWING's pendulum
// physics). One TAP releases it; it falls onto the tower. WHERE it lands (your
// release timing on the arc) decides the STACK cut: dead-centre = PERFECT (no
// cut + grow back + combo), partial = sliced, total miss = it falls past = over.
const H = 1.0;             // block layer height
const BASE = 9;            // starting footprint
const ROPE_LEN = 11;       // pendulum rope length
const ANCHOR_H = 16;       // anchor height above the current tower top
const GRAV = 44;           // gravity for the dropped block (snappy fall)
// The cut is decided by WHERE you release on the arc (the SWING skill); the
// block then falls straight down from that point so a centred tap always reads
// as centred (the STACK promise). No horizontal drift betraying a good release.
const VEL_TRANSFER = 0;
const SWING_AMP0 = 0.7;    // starting swing amplitude (radians from vertical)
const SWING_AMP_STEP = 0.035; // amplitude grows per layer (harder)
const SWING_AMP_MAX = 1.15;
const SWING_W0 = 1.7;      // starting angular speed (rad/s)
const SWING_W_STEP = 0.05; // angular speed grows per layer (harder)
const SWING_W_MAX = 3.4;
const PERFECT_EPS = 0.55;  // |offset| under this = perfect (no cut)
const PERFECT_REGROW = 0.6;
const CAM_H = 14;

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
    this.scene.fog = new THREE.Fog(0x121a38, 55, 150);
    this._sky();

    // iso-ish camera looking at the tower top, from a fixed angle, rising up
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 600);
    this.camOff = new THREE.Vector3(34, 26, 34);
    this.camLookY = 0; this.camTargetY = 0;

    this._lights();
    this._ground();
    this._anchorRig();
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
    const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x0c1638) }, bot: { value: new THREE.Color(0x35225e) } },
      vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 bot;
        void main(){ float h=normalize(vP).y*0.5+0.5; gl_FragColor=vec4(mix(bot,top,smoothstep(0.0,1.0,h)),1.0);}` });
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  _lights() {
    this.scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x10121f, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(16, 30, 12); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 30; Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 130 });
    sun.shadow.bias = -0.0004; sun.shadow.radius = 5;
    this.scene.add(sun); this.scene.add(sun.target); this.sun = sun;
  }

  _ground() {
    this.pedestal = new THREE.Mesh(new THREE.BoxGeometry(BASE, 60, BASE),
      new THREE.MeshStandardMaterial({ color: 0x141d36, roughness: 0.6, metalness: 0.1 }));
    this.pedestal.position.y = -30; this.pedestal.receiveShadow = true; this.pedestal.castShadow = true;
    this.scene.add(this.pedestal);
  }

  // the swinging rig: an anchor knob + the hanging block + the rope line
  _anchorRig() {
    this.anchorMesh = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x2ee6c9, emissive: 0x2ee6c9, emissiveIntensity: 1.4, roughness: 0.3 }));
    this.scene.add(this.anchorMesh);
    this.ropeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.ropeLine = new THREE.Line(this.ropeGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    this.scene.add(this.ropeLine);
    // the moving (swinging / falling) block — geometry swapped per layer
    this.moverMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.05 });
    this.mover = new THREE.Mesh(new THREE.BoxGeometry(BASE, H, BASE), this.moverMat);
    this.mover.castShadow = true; this.scene.add(this.mover);
    // a thin guide line dropping from the block so you can read its X vs the top
    this.guideMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 });
    this.guideGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.guide = new THREE.Line(this.guideGeo, this.guideMat); this.scene.add(this.guide);
  }

  _fragments() {
    this.frags = [];
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, H, 1), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      m.castShadow = true; m.visible = false; this.scene.add(m);
      this.frags.push({ mesh: m, life: 0, vy: 0, vx: 0, vz: 0, spin: 0 });
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
      c.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.55, 0.88));
      c.setSize(innerWidth, innerHeight);
      this.composer = c;
    } catch (e) { this.composer = null; }
  }

  // ---------------------------------------------------------------- state --
  _reset() {
    if (this.stack) for (const b of this.stack) this.scene.remove(b.mesh);
    for (const f of this.frags) { f.life = 0; f.mesh.visible = false; }
    this.stack = [];
    this.score = 0; this.perfectCombo = 0;
    this.hue = Math.random();
    this.over = false; this.overT = 0; this._shownResult = false;
    this.camLookY = 0; this.camTargetY = 0;
    this.shakeAmt = 0;

    // base block on the pedestal
    const base = this._makeBlock(BASE, BASE, 0);
    base.mesh.position.set(0, 0, 0);
    this.stack.push(base);

    // axis the swing happens along alternates each layer (X, then Z) — keeps the
    // STACK feel of cutting on alternating sides, now driven by the pendulum
    this.axis = 'x';
    this._spawnSwing();
    this.hud.setScore(0); this.hud.hideResult();
  }

  _color(layer) { const c = new THREE.Color(); c.setHSL((this.hue + layer * 0.035) % 1, 0.58, 0.56); return c; }

  _makeBlock(sx, sz, layer) {
    const geo = new THREE.BoxGeometry(sx, H, sz);
    const mat = new THREE.MeshStandardMaterial({ color: this._color(layer), roughness: 0.5, metalness: 0.05 });
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);
    return { mesh, sx, sz, layer };
  }

  // start the next block swinging on the rope above the tower top
  _spawnSwing() {
    const top = this.stack[this.stack.length - 1];
    const layer = this.stack.length;
    this.axis = (layer % 2 === 1) ? 'x' : 'z';
    this.topY = layer * H;                          // height the block will land at
    this.anchorY = this.topY + ANCHOR_H;            // anchor hangs above
    this.anchorPos = new THREE.Vector3(top.mesh.position.x, this.anchorY, top.mesh.position.z);
    // the swing plane is along the active axis through the tower centre
    this.swingAmp = clamp(SWING_AMP0 + layer * SWING_AMP_STEP, SWING_AMP0, SWING_AMP_MAX);
    this.swingW = clamp(SWING_W0 + layer * SWING_W_STEP, SWING_W0, SWING_W_MAX);
    this.swingT = Math.random() * Math.PI * 2;      // random phase so it's not rote
    // mover takes the size of the current top (STACK rule)
    this.mover.geometry.dispose();
    this.mover.geometry = new THREE.BoxGeometry(top.sx, H, top.sz);
    this.moverMat.color.copy(this._color(layer));
    this.moverSx = top.sx; this.moverSz = top.sz;
    this.dropping = false; this.dropV = 0;
    this.moverPos = new THREE.Vector3();
    this.moverVel = 0;                              // horizontal velocity along axis at release
    this.camTargetY = this.topY;
  }

  start() { this._reset(); this.running = true; this.clock.getDelta(); this._loop(); }
  restart() { this._reset(); this.running = true; }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 1 / 30);
    try {
      if (this.running) this._update(dt);
      this._render(dt);
      if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    } catch (e) { this.running = false; if (this.onError) this.onError(e); }
  }

  _update(dt) {
    if (this.over) {
      this.overT += dt; this._stepFrags(dt);
      if (this.overT > 0.6 && !this._shownResult) { this._shownResult = true; this._finish(); }
      return;
    }

    if (!this.dropping) {
      // SWING phase: pendulum angle oscillates; block hangs at rope end
      this.swingT += this.swingW * dt;
      this.angle = Math.sin(this.swingT) * this.swingAmp;     // 0 = straight down
      const off = Math.sin(this.angle) * ROPE_LEN;            // horizontal offset along axis
      const drop = Math.cos(this.angle) * ROPE_LEN;           // how far below the anchor
      this.moverPos.copy(this.anchorPos);
      this.moverPos[this.axis] += off;
      this.moverPos.y = this.anchorY - drop;
      // audible swing speed (fastest at the bottom of the arc)
      const speed01 = Math.abs(Math.cos(this.swingT)) * (this.swingW / SWING_W_MAX);
      this.audio.swing(clamp(speed01, 0, 1));

      if (this.input.tapped) {
        this.input.endFrame();
        // RELEASE: convert pendulum motion into a falling block that keeps its
        // horizontal velocity (the SWING skill — release timing sets the landing)
        const angVel = Math.cos(this.swingT) * this.swingAmp * this.swingW; // d(angle)/dt
        this.moverVel = Math.cos(this.angle) * ROPE_LEN * angVel * VEL_TRANSFER; // horizontal v
        this.dropV = 0; this.dropping = true;
        this.audio.release();
      }
    } else {
      // DROP phase: ballistic fall; horizontal coasts; land when bottom hits topY
      this.dropV -= GRAV * dt;
      this.moverPos.y += this.dropV * dt;
      this.moverPos[this.axis] += this.moverVel * dt;
      if (this.moverPos.y <= this.topY + H) {
        this.moverPos.y = this.topY + H;
        this._land();
      }
    }
    this.input.endFrame();
  }

  // STACK resolution at the block's landed X (or Z) position
  _land() {
    const top = this.stack[this.stack.length - 1];
    const ax = this.axis;
    const sizeKey = ax === 'x' ? 'sx' : 'sz';
    const delta = this.moverPos[ax] - top.mesh.position[ax];
    const overlap = top[sizeKey] - Math.abs(delta);

    if (overlap <= 0) {
      // total miss -> the block tumbles past the tower: game over
      this._spawnFragment(this.moverPos.clone(), this.moverSx, this.moverSz, ax, true);
      this.over = true; this.overT = 0; this.audio.over(); this._shake(1.0);
      return;
    }

    let newSize = overlap;
    let center = top.mesh.position[ax] + delta / 2;

    if (Math.abs(delta) <= PERFECT_EPS) {
      // PERFECT: no cut, snap centred, grow back toward base, combo up
      this.perfectCombo++;
      newSize = Math.min(BASE, top[sizeKey] + PERFECT_REGROW);
      center = top.mesh.position[ax];
      this.audio.perfect(this.perfectCombo);
      this._flashPerfect(center);
      this._shake(0.12);
    } else {
      this.perfectCombo = 0;
      // the sliced-off overhang falls away
      const cutCenter = this.moverPos[ax] + Math.sign(delta) * (overlap / 2 + Math.abs(delta) / 2);
      const cutPos = this.moverPos.clone(); cutPos[ax] = cutCenter;
      const cutSx = ax === 'x' ? Math.abs(delta) : this.moverSx;
      const cutSz = ax === 'z' ? Math.abs(delta) : this.moverSz;
      this._spawnFragment(cutPos, cutSx, cutSz, ax, false);
      this.audio.place(this.stack.length);
    }

    // lock the resized block in as the new tower top
    const finalSx = ax === 'x' ? newSize : this.moverSx;
    const finalSz = ax === 'z' ? newSize : this.moverSz;
    const b = this._makeBlock(finalSx, finalSz, this.stack.length);
    b.mesh.position.set(ax === 'x' ? center : top.mesh.position.x, this.topY, ax === 'z' ? center : top.mesh.position.z);
    this.stack.push(b);

    this.score++;
    this.hud.setScore(this.score);
    if (this.score > this.best) { this.best = this.score; this._saveBest(this.best); this.hud.setBest(this.best); }

    this._spawnSwing();
  }

  _spawnFragment(pos, sx, sz, ax, whole) {
    const f = this.frags[this.fragCursor]; this.fragCursor = (this.fragCursor + 1) % this.frags.length;
    f.mesh.geometry.dispose();
    f.mesh.geometry = new THREE.BoxGeometry(Math.max(0.1, sx), H, Math.max(0.1, sz));
    f.mesh.material.color.copy(this.moverMat.color);
    f.mesh.position.copy(pos); f.mesh.rotation.set(0, 0, 0);
    f.mesh.visible = true; f.life = 1;
    f.vy = 1.5; f.spin = (Math.random() - 0.5) * 6;
    const dir = whole ? (Math.random() - 0.5) * 2 : Math.sign(pos[ax] - this.stack[this.stack.length - 1].mesh.position[ax]) || 1;
    f.vx = ax === 'x' ? dir * 5 : (Math.random() - 0.5) * 2;
    f.vz = ax === 'z' ? dir * 5 : (Math.random() - 0.5) * 2;
    if (whole) { f.vy = 2; }
    this.audio.slice();
  }
  _stepFrags(dt) {
    for (const f of this.frags) {
      if (f.life <= 0) continue;
      f.life -= dt * 0.5; f.vy -= 22 * dt;
      f.mesh.position.x += f.vx * dt; f.mesh.position.y += f.vy * dt; f.mesh.position.z += f.vz * dt;
      f.mesh.rotation.x += f.spin * dt; f.mesh.rotation.z += f.spin * 0.7 * dt;
      if (f.life <= 0) f.mesh.visible = false;
    }
  }

  _flashPerfect(centerOnAxis) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.5, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    const top = this.stack[this.stack.length - 1];
    ring.position.set(this.axis === 'x' ? centerOnAxis : top.mesh.position.x, this.topY + H / 2 + 0.02,
      this.axis === 'z' ? centerOnAxis : top.mesh.position.z);
    this.scene.add(ring);
    const t0 = performance.now();
    const anim = () => {
      const k = (performance.now() - t0) / 350;
      if (k >= 1) { this.scene.remove(ring); ring.geometry.dispose(); return; }
      ring.scale.setScalar(1 + k * 7); ring.material.opacity = 0.9 * (1 - k);
      requestAnimationFrame(anim);
    };
    anim();
  }

  _render(dt) {
    // place the mover (swinging or falling)
    this.mover.position.copy(this.moverPos);
    this.mover.rotation.z = this.dropping ? 0 : (this.axis === 'x' ? -this.angle : 0);
    this.mover.rotation.x = this.dropping ? 0 : (this.axis === 'z' ? this.angle : 0);

    // anchor + rope follow
    this.anchorMesh.position.copy(this.anchorPos);
    if (!this.dropping) {
      this.ropeLine.visible = true;
      this.ropeGeo.setFromPoints([this.anchorPos, this.moverPos]);
    } else this.ropeLine.visible = false;

    // guide line straight down from the block to the tower top (reads landing X)
    this.guide.visible = !this.over;
    this.guideGeo.setFromPoints([
      new THREE.Vector3(this.moverPos.x, this.moverPos.y - H / 2, this.moverPos.z),
      new THREE.Vector3(this.moverPos.x, this.topY + H / 2, this.moverPos.z)]);

    this._stepFrags(dt);

    // camera rises smoothly to keep the tower top framed, with shake
    this.camLookY = lerp(this.camLookY, this.camTargetY, 1 - Math.exp(-dt * 4));
    const sh = this.shakeAmt; this.shakeAmt *= Math.pow(0.0001, dt);
    const look = new THREE.Vector3(0, this.camLookY + 4, 0);
    const p = look.clone().add(this.camOff);
    p.x += (Math.random() - 0.5) * sh; p.y += (Math.random() - 0.5) * sh;
    this.camera.position.lerp(p, 1 - Math.exp(-dt * 5));
    this.camera.lookAt(look);
    this.sun.position.set(16, this.camLookY + 30, 12);
    this.sun.target.position.set(0, this.camLookY, 0); this.sun.target.updateMatrixWorld();
  }

  _shake(a) { this.shakeAmt = Math.min(2, this.shakeAmt + a); }

  _finish() {
    this.running = false; this.audio.swing(0);
    const isBest = this.score >= this.best && this.score > 0;
    this.hud.showResult(this.score, this.best, isBest);
  }

  _loadBest() { try { return +localStorage.getItem('swingstack.best') || 0; } catch { return 0; } }
  _saveBest(v) { try { localStorage.setItem('swingstack.best', String(v)); } catch {} }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(w, h);
  }
}
