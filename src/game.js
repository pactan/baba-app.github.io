import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
// Bloom is loaded dynamically below so a missing addon can't block startup.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// --- SWING: one button. HOLD = rope to nearest anchor + swing. RELEASE = fly. -
// Pure 2D physics in the X-Y plane (X = forward, Y = up). The whole skill is
// WHEN you let go: release at the bottom/forward of an arc to convert swing into
// distance. No levels, no timing windows — just gravity + momentum.
const GRAV = 26;            // gravity (units/s^2) — floaty, forgiving arcs
const MOVE0 = 22;           // starting forward speed so the first grab is easy
const ROPE_DAMP = 1.0;      // pendulum keeps all energy (juicy, lossless swings)
const AIR_DRAG = 0.012;     // very light air drag
const ANCHOR_Y = 34;        // anchors hang high so there's lots of room below
const GAP_MIN = 22, GAP_MAX = 30;   // horizontal spacing between anchors
const GROUND_Y = 0;         // touch this = crash
const PLAYER_Y0 = 18;       // spawn height (mid-air, plenty of headroom)

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
    this.scene.fog = new THREE.Fog(0x10182e, 70, 200);
    this._sky();

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
    this.camZ = 56;            // side-on camera distance (game lives in X-Y)

    this.seed = (Math.random() * 1e9) | 0;
    this._lights();
    this._ground();
    this._anchors();
    this._player();
    this._rope();
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

  _rng() {
    this.seed |= 0; this.seed = this.seed + 0x6D2B79F5 | 0;
    let t = Math.imul(this.seed ^ this.seed >>> 15, 1 | this.seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  _sky() {
    const geo = new THREE.SphereGeometry(420, 32, 16);
    const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x0a1330) }, bot: { value: new THREE.Color(0x3a2360) } },
      vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 bot;
        void main(){ float h=normalize(vP).y*0.5+0.5; gl_FragColor=vec4(mix(bot,top,smoothstep(0.0,1.0,h)),1.0);}` });
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  _lights() {
    this.scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x10121f, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(-10, 30, 20); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const d = 40; Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 120 });
    sun.shadow.bias = -0.0005; this.scene.add(sun); this.scene.add(sun.target); this.sun = sun;
  }

  _ground() {
    const tex = makeGridTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(60, 4);
    this.groundMat = new THREE.MeshStandardMaterial({ map: tex, color: 0x121a2e, roughness: 0.9, emissive: 0x0a1228, emissiveIntensity: 0.5 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 60), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = GROUND_Y; this.ground.position.z = 0;
    this.ground.receiveShadow = true; this.scene.add(this.ground);
    // a glowing danger line at ground level
    this.dangerLine = new THREE.Mesh(new THREE.BoxGeometry(4000, 0.3, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xff3b6b }));
    this.dangerLine.position.set(0, 0.4, 0); this.scene.add(this.dangerLine);
  }

  // pooled anchor posts (the points you grapple to)
  _anchors() {
    this.anchors = [];
    for (let i = 0; i < 10; i++) {
      const g = new THREE.Group();
      const knob = new THREE.Mesh(new THREE.SphereGeometry(1.1, 18, 14),
        new THREE.MeshStandardMaterial({ color: 0x2ee6c9, emissive: 0x2ee6c9, emissiveIntensity: 1.3, roughness: 0.3 }));
      knob.position.y = ANCHOR_Y; knob.castShadow = true; g.add(knob);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, ANCHOR_Y, 8),
        new THREE.MeshStandardMaterial({ color: 0x162540, emissive: 0x10203a, emissiveIntensity: 0.6, roughness: 0.6 }));
      post.position.y = ANCHOR_Y / 2; g.add(post);
      this.scene.add(g);
      this.anchors.push({ group: g, knob, x: 0, used: false });
    }
  }

  _player() {
    this.pBody = new THREE.Group();
    this.pMat = new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.3, metalness: 0.1,
      emissive: 0xffae00, emissiveIntensity: 0.5 });
    const box = new THREE.Mesh(new RoundedBoxGeometry(2, 2, 2, 5, 0.25), this.pMat);
    box.castShadow = true; this.pBody.add(box);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
    this.pBody.add(edges);
    this.scene.add(this.pBody);
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(3, 3),
      new THREE.MeshBasicMaterial({ map: makePuff(0.7), color: 0, transparent: true, opacity: 0.35, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2; this.scene.add(this.blob);
  }

  _rope() {
    this.ropeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    this.ropeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.ropeLine = new THREE.Line(this.ropeGeo, this.ropeMat);
    this.ropeLine.visible = false; this.scene.add(this.ropeLine);
  }

  _fx() {
    const tex = makePuff();
    this.fx = [];
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; this.scene.add(m);
      this.fx.push({ mesh: m, life: 0, vx: 0, vy: 0 });
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
      c.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.6, 0.85));
      c.setSize(innerWidth, innerHeight);
      this.composer = c;
    } catch (e) { this.composer = null; }
  }

  // ---------------------------------------------------------------- state --
  _reset() {
    this.px = 0; this.py = PLAYER_Y0;        // player position (X forward, Y up)
    this.vx = MOVE0; this.vy = 0;            // velocity
    this.attached = false; this.anchor = null; this.ropeLen = 0; this.angVel = 0;
    this.dist = 0; this.score = 0; this.combo = 0;
    this.over = false; this.overT = 0; this._shownResult = false;
    this.shakeAmt = 0; this.spin = 0;
    for (const f of this.fx) { f.life = 0; f.mesh.visible = false; }
    // lay anchors out ahead
    let x = 16;
    for (const a of this.anchors) { this._placeAnchor(a, x); x += lerp(GAP_MIN, GAP_MAX, this._rng()); }
    this.ropeLine.visible = false;
    this.hud.setScore(0); this.hud.hideResult();
  }

  _placeAnchor(a, x) {
    a.x = x; a.used = false;
    a.group.position.x = x;
    a.knob.material.emissiveIntensity = 1.3;
  }

  start() { this._reset(); this.running = true; this.clock.getDelta(); this._loop(); }
  restart() { this.seed = (Math.random() * 1e9) | 0; this._reset(); this.running = true; }

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
    if (this.over) { this.overT += dt; if (this.overT > 0.6 && !this._shownResult) { this._shownResult = true; this._finish(); } return; }

    const want = this.input.held;

    // attach / detach on the rising/falling edge of HOLD
    if (want && !this.attached) this._tryAttach();
    if (!want && this.attached) this._detach();

    if (this.attached) this._stepPendulum(dt);
    else this._stepBallistic(dt);

    // crash on the ground
    if (this.py <= GROUND_Y + 1) {
      this.py = GROUND_Y + 1;
      this.over = true; this.overT = 0; this.attached = false; this.ropeLine.visible = false;
      this.audio.crash(); this._burst(0xff3b6b, 24); this._shake(1.1);
      return;
    }

    // distance score
    this.dist = Math.max(this.dist, this.px);
    const newScore = Math.floor(this.dist / 4);
    if (newScore !== this.score) {
      this.score = newScore; this.hud.setScore(this.score);
      if (this.score > this.best) { this.best = this.score; this._saveBest(this.best); this.hud.setBest(this.best); }
    }

    this._recycleAnchors();
    const speed = Math.hypot(this.vx, this.vy);
    this.audio.wind(clamp(speed / 60, 0, 1));
  }

  // grab the nearest anchor that's ahead-ish and within reach
  _tryAttach() {
    let best = null, bestD = Infinity;
    for (const a of this.anchors) {
      const dx = a.x - this.px, dy = ANCHOR_Y - this.py;
      const d = Math.hypot(dx, dy);
      // prefer anchors ahead or overhead, within a generous reachable radius
      if (a.x > this.px - 10 && d < 44 && d < bestD) { bestD = d; best = a; }
    }
    if (!best) return;
    this.attached = true; this.anchor = best;
    this.ropeLen = Math.max(8, bestD);
    // seed angular velocity from current linear velocity (tangential component)
    const ax = best.x, ay = ANCHOR_Y;
    const rx = this.px - ax, ry = this.py - ay;
    const ang = Math.atan2(ry, rx);
    // tangential direction is perpendicular to the rope
    const tx = -Math.sin(ang), ty = Math.cos(ang);
    const vt = this.vx * tx + this.vy * ty;
    this.angVel = vt / this.ropeLen;
    this.curAng = ang;
    this.audio.grab(); this.ropeLine.visible = true;
    if (!best.used) { best.used = true; best.knob.material.emissiveIntensity = 2.4; }
  }

  _stepPendulum(dt) {
    const ax = this.anchor.x, ay = ANCHOR_Y;
    // pendulum angular dynamics: a'' = -(g/L) cos(theta)   (theta from +x axis,
    // measuring the bob position rx=L cos, ry=L sin; gravity acts on ry)
    const angAcc = -(GRAV / this.ropeLen) * Math.cos(this.curAng);
    this.angVel += angAcc * dt;
    this.angVel *= ROPE_DAMP;
    this.curAng += this.angVel * dt;
    // position on the circle
    this.px = ax + Math.cos(this.curAng) * this.ropeLen;
    this.py = ay + Math.sin(this.curAng) * this.ropeLen;
    // cache linear velocity (tangential) so release launches cleanly
    const tx = -Math.sin(this.curAng), ty = Math.cos(this.curAng);
    const v = this.angVel * this.ropeLen;
    this.vx = tx * v; this.vy = ty * v;
  }

  _stepBallistic(dt) {
    this.vy -= GRAV * dt;
    this.vx *= (1 - AIR_DRAG * dt); this.vy *= (1 - AIR_DRAG * dt);
    this.px += this.vx * dt; this.py += this.vy * dt;
  }

  _detach() {
    this.attached = false; this.anchor = null; this.ropeLine.visible = false;
    this.audio.release();
    // a clean release while moving up-and-forward = a "good launch": small boost
    if (this.vx > 6 && this.vy > -2) {
      this.combo++; this.audio.land(this.combo); this._burst(0x2ee6c9, 8);
      this.vx *= 1.08; this.vy += 2;                    // reward good timing
    } else this.combo = 0;
    // never launch backwards — keep the run always moving forward
    if (this.vx < 6) this.vx = 6;
    this.spin = 0.6;
  }

  _recycleAnchors() {
    // any anchor well behind the player jumps to the far end
    let maxX = -Infinity; for (const a of this.anchors) maxX = Math.max(maxX, a.x);
    for (const a of this.anchors) {
      if (a.x < this.px - 40) this._placeAnchor(a, maxX + lerp(GAP_MIN, GAP_MAX, this._rng())), maxX = a.x;
    }
  }

  _render(dt) {
    this.spin = lerp(this.spin, 0, Math.min(1, dt * 6));
    this.pBody.position.set(this.px, this.py, 0);
    // cube tumbles a touch on release / spins with angular motion while swinging
    if (this.attached) this.pBody.rotation.z = this.curAng + Math.PI / 2;
    else { this.pBody.rotation.z += (this.over ? dt * 10 : this.spin); }
    this.pBody.rotation.y += dt * 0.5;

    this.blob.position.set(this.px, GROUND_Y + 0.06, 0);
    const air = clamp(1 - (this.py - GROUND_Y) / 24, 0.15, 0.85);
    this.blob.scale.setScalar(1 + (1 - air) * 2); this.blob.material.opacity = air * 0.4;

    // rope line
    if (this.attached && this.anchor) {
      const pts = [new THREE.Vector3(this.anchor.x, ANCHOR_Y, 0), new THREE.Vector3(this.px, this.py, 0)];
      this.ropeGeo.setFromPoints(pts);
    }

    // ground + sky follow X so the world feels infinite
    this.ground.position.x = this.px;
    this.groundMat.map.offset.x = this.px * 0.02;
    this.dangerLine.position.x = this.px;

    // camera tracks the player from the side, easing, with a little shake
    const sh = this.shakeAmt; this.shakeAmt *= Math.pow(0.0001, dt);
    const camY = clamp(this.py * 0.5 + 6, 8, 26);
    const target = new THREE.Vector3(this.px + 6, camY, this.camZ);
    this.camera.position.lerp(target, 1 - Math.exp(-dt * 5));
    this.camera.position.x += (Math.random() - 0.5) * sh; this.camera.position.y += (Math.random() - 0.5) * sh;
    this.camera.lookAt(this.px + 6, clamp(this.py * 0.5 + 4, 6, 24), 0);

    this.sun.position.set(this.px - 10, 30, 20); this.sun.target.position.set(this.px, 8, 0); this.sun.target.updateMatrixWorld();

    // player tints toward red as it nears the ground (danger read)
    const danger = clamp(1 - (this.py - GROUND_Y) / 12, 0, 1);
    this.pMat.emissive.setRGB(0.5 + danger * 0.5, 0.42 * (1 - danger), 0.0);

    this._updateFx(dt);
  }

  _burst(color, n) {
    const col = (color instanceof THREE.Color) ? color : new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const p = this.fx[this.fxCursor]; this.fxCursor = (this.fxCursor + 1) % this.fx.length;
      p.mesh.position.set(this.px, this.py, 0);
      const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 9;
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp; p.life = 1;
      p.mesh.material.color.copy(col); p.mesh.material.opacity = 1;
      p.mesh.scale.setScalar(0.4 + Math.random() * 0.7); p.mesh.visible = true;
    }
  }
  _updateFx(dt) {
    for (const p of this.fx) {
      if (p.life <= 0) continue;
      p.life -= dt * 1.8; p.vy -= 10 * dt;
      p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt;
      p.mesh.quaternion.copy(this.camera.quaternion);
      p.mesh.material.opacity = Math.max(0, p.life);
      if (p.life <= 0) p.mesh.visible = false;
    }
  }

  _shake(a) { this.shakeAmt = Math.min(2, this.shakeAmt + a); }

  _finish() {
    this.running = false; this.audio.wind(0);
    const isBest = this.score >= this.best && this.score > 0;
    this.hud.showResult(this.score, this.best, isBest);
  }

  _loadBest() { try { return +localStorage.getItem('swing.best') || 0; } catch { return 0; } }
  _saveBest(v) { try { localStorage.setItem('swing.best', String(v)); } catch {} }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(w, h);
  }
}

function makeGridTexture() {
  const s = 128; const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  g.fillStyle = '#0b1024'; g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(90,130,255,0.4)'; g.lineWidth = 2;
  g.strokeRect(1, 1, s - 2, s - 2);
  return new THREE.CanvasTexture(cv);
}
function makePuff(strength = 0.9) {
  const s = 64; const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, `rgba(255,255,255,${strength})`); grd.addColorStop(0.4, `rgba(255,255,255,${strength * 0.5})`);
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}
