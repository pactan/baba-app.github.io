import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
// Bloom is loaded dynamically below so a missing addon can't block startup.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// --- NERVE: press-your-luck greed × one-tap hop-runner ----------------------
// Every hop grows your POT and your MULTIPLIER, but raises the bust RISK (shown
// before you commit). BANK to lock the pot*mult into your score and reset risk.
// A well-TIMED hop (tap while the pad pulse is bright) adds less risk — skill.
const TILE = 4.2;            // spacing between pads
// Tuned by Monte-Carlo (balance.js): optimal stop lands at ~6 hops with a clear
// rise-then-fall EV curve — a real press-your-luck sweet spot.
const BASE_RISK = 5;         // % bust chance on the very first hop of a streak
const RISK_STEP = 4;         // % added per hop (greed tax)
const RISK_STEP_PERFECT = 2; // reduced risk add on a perfectly-timed hop
const MAX_RISK = 92;         // risk is capped so a streak is never truly hopeless
const PULSE = 1.15;          // seconds per pad "safe-window" pulse
const PERFECT_FRAC = 0.34;   // fraction of the pulse that counts as perfect
const HOP_TIME = 0.16;       // travel time per hop (visual)

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
    this.scene.background = new THREE.Color(0x080a16);
    this.scene.fog = new THREE.Fog(0x080a16, 30, 90);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);

    // deterministic RNG per run so the "is this hop safe?" is honest, not feel-bad
    this.seed = (Math.random() * 1e9) | 0;

    this._lights();
    this._pads();
    this._player();
    this._coinsFx();
    this._post();

    this.best = this._loadBest();
    this._reset();
    this.running = false;
    this.hud.setBest(this.best);

    this.clock = new THREE.Clock();
    addEventListener('resize', () => this._resize());
    this._resize();
  }

  _rng() { // mulberry32
    this.seed |= 0; this.seed = this.seed + 0x6D2B79F5 | 0;
    let t = Math.imul(this.seed ^ this.seed >>> 15, 1 | this.seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  _lights() {
    this.scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x10121f, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(8, 20, 6); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 80;
    const d = 26; Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
    sun.shadow.bias = -0.0005;
    this.scene.add(sun); this.scene.add(sun.target); this.sun = sun;
  }

  // a recycled line of floating pads stretching ahead (+z). Index 0 = current.
  _pads() {
    this.padMat = new THREE.MeshStandardMaterial({ color: 0x223052, roughness: 0.5, metalness: 0.2,
      emissive: 0x2a6cff, emissiveIntensity: 0.5 });
    this.pads = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new RoundedBoxGeometry(3.2, 0.8, 3.2, 4, 0.25), this.padMat.clone());
      m.receiveShadow = true; m.castShadow = true; this.scene.add(m);
      // a thin glowing ring on top that pulses (the timing "safe window")
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.12, 10, 28),
        new THREE.MeshBasicMaterial({ color: 0x6ad0ff }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.5; m.add(ring);
      this.pads.push({ mesh: m, ring });
    }
  }

  _player() {
    this.player = new THREE.Group();
    this.pMat = new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.3, metalness: 0.1,
      emissive: 0xffae00, emissiveIntensity: 0.5 });
    const box = new THREE.Mesh(new RoundedBoxGeometry(1.6, 1.6, 1.6, 5, 0.2), this.pMat);
    box.castShadow = true; this.player.add(box);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.6, 1.6, 1.6)),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 }));
    this.player.add(edges);
    this.scene.add(this.player);
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshBasicMaterial({ map: makePuff(0.7), color: 0, transparent: true, opacity: 0.4, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2; this.scene.add(this.blob);
  }

  _coinsFx() {
    const tex = makePuff();
    this.fx = [];
    for (let i = 0; i < 50; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; this.scene.add(m);
      this.fx.push({ mesh: m, life: 0, vx: 0, vy: 0, vz: 0 });
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
      c.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.6, 0.85));
      c.setSize(innerWidth, innerHeight);
      this.composer = c;
    } catch (e) { this.composer = null; }
  }

  // ---------------------------------------------------------------- state --
  _reset() {
    this.tile = 0;                 // how many pads we've advanced overall
    this.pot = 0;                  // unbanked coins this streak
    this.streak = 0;               // hops since last bank (drives mult + risk)
    this.mult = 1;
    this.risk = BASE_RISK;         // bust % the NEXT hop carries
    this.score = 0;
    this.over = false; this.overT = 0; this._shownResult = false;
    this.busted = false;
    this.hopAnim = 1;              // 1 = settled on a pad
    this.fromPos = new THREE.Vector3(0, 0, 0);
    this.toPos = new THREE.Vector3(0, 0, 0);
    this.pos = new THREE.Vector3(0, 0, 0);
    this.pulse = 0;
    this.shakeAmt = 0;
    for (const f of this.fx) { f.life = 0; f.mesh.visible = false; }
    this._layoutPads();
    this._pushHud();
    this.hud.hideResult();
  }

  // place pads ahead of the current tile
  _layoutPads() {
    for (let i = 0; i < this.pads.length; i++) {
      this.pads[i].mesh.position.set(0, 0, (this.tile + i) * TILE);
    }
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
    if (this.over) {
      this.overT += dt;
      if (this.overT > 0.6 && !this._shownResult) { this._shownResult = true; this._finish(); }
      this.input.endFrame();
      return;
    }

    this.pulse = (this.pulse + dt / PULSE) % 1;          // 0..1 timing pulse
    if (this.hopAnim < 1) this.hopAnim = clamp(this.hopAnim + dt / HOP_TIME, 0, 1);

    const settled = this.hopAnim >= 1;

    if (settled && this.input.bank) { this.input.endFrame(); return this._bank(); }
    if (settled && this.input.hop) { this.input.endFrame(); return this._hop(); }
    this.input.endFrame();
  }

  // pure: given current risk %, roll the seeded RNG to decide bust
  _rollBust(riskPct) { return this._rng() * 100 < riskPct; }

  _hop() {
    // timing: is the pulse inside the "perfect" window? (near its peak)
    const dist = Math.min(this.pulse, 1 - this.pulse);     // 0 at peak (pulse=0/1)
    const perfect = dist < PERFECT_FRAC / 2 || (1 - this.pulse) < PERFECT_FRAC / 2;
    const isPerfect = this.pulse < PERFECT_FRAC / 2 || this.pulse > 1 - PERFECT_FRAC / 2;

    // resolve THIS hop against the risk it was carrying
    if (this._rollBust(this.risk)) {
      // BUST — lose the whole unbanked pot
      this.busted = true; this.over = true; this.overT = 0;
      this.audio.bust(); this._shake(1.1); this._burst(0xff3b3b, 26);
      this.pot = 0; this.streak = 0;
      this._pushHud();
      // still advance visually into the gap as a "fall"
      this.fromPos.copy(this.pos); this.toPos.set(0, -8, (this.tile + 1) * TILE);
      this.hopAnim = 0;
      return;
    }

    // SURVIVED the hop: advance, grow pot + multiplier, raise next risk
    this.tile++;
    this.streak++;
    this.mult = 1 + Math.floor(this.streak / 3);           // +1x every 3 hops
    const gain = 10 * this.mult;
    this.pot += gain;
    const step = isPerfect ? RISK_STEP_PERFECT : RISK_STEP;
    this.risk = clamp(this.risk + step, BASE_RISK, MAX_RISK);

    this.audio.hop(this.streak);
    if (isPerfect) this.audio.near();
    this._burst(isPerfect ? 0x6affd0 : 0xffd23a, isPerfect ? 12 : 6);

    // animate the hop + slide pads back into view
    this.fromPos.copy(this.pos);
    this.toPos.set(0, 0, this.tile * TILE);
    this.hopAnim = 0;
    this._recyclePads();
    this._pushHud(isPerfect);
  }

  _bank() {
    if (this.streak === 0) return;                          // nothing to bank
    const cashed = this.pot;
    this.score += cashed;
    if (this.score > this.best) { this.best = this.score; this._saveBest(this.best); this.hud.setBest(this.best); }
    this.audio.bank(this.streak);
    this._burst(0xffd23a, 22); this._shake(0.3);
    this.hud.bankFlash(cashed);
    // reset the streak — risk goes back to base, you keep your score
    this.pot = 0; this.streak = 0; this.mult = 1; this.risk = BASE_RISK;
    this._pushHud();
  }

  _recyclePads() {
    // keep the line of pads anchored ahead of the player
    for (let i = 0; i < this.pads.length; i++) {
      this.pads[i].mesh.position.z = (this.tile + i) * TILE;
    }
  }

  _pushHud(perfect) {
    this.hud.setScore(this.score);
    this.hud.setStreak(this.streak, this.mult);
    this.hud.setPot(this.pot);
    // show the risk the NEXT hop will carry, and whether a perfect just landed
    this.hud.setRisk(this.streak === 0 ? BASE_RISK : this.risk, perfect);
  }

  _render(dt) {
    // hop arc
    const k = this.hopAnim;
    const ease = k < 1 ? (1 - Math.pow(1 - k, 2)) : 1;
    this.pos.lerpVectors(this.fromPos, this.toPos, ease);
    const arc = this.busted ? 0 : Math.sin(Math.min(k, 1) * Math.PI) * 1.3;
    this.player.position.set(this.pos.x, this.pos.y + arc + 0.9, this.pos.z);
    this.player.rotation.x = -ease * Math.PI * (this.busted ? 0 : 0.5) + (this.busted ? this.overT * 8 : 0);
    this.player.rotation.y += dt * 0.8;
    this.blob.position.set(this.pos.x, 0.46, this.pos.z);
    this.blob.visible = !this.busted;

    // pulse the ring of the pad we're ON (the timing cue) — bright at the window
    const glow = 0.5 + 0.5 * Math.cos(this.pulse * Math.PI * 2); // 1 at pulse 0/1
    for (let i = 0; i < this.pads.length; i++) {
      const p = this.pads[i];
      const isCurrent = Math.abs(p.mesh.position.z - this.tile * TILE) < 0.1;
      p.ring.scale.setScalar(isCurrent ? (0.8 + glow * 0.5) : 0.75);
      p.ring.material.color.setHex(isCurrent ? (glow > 0.7 ? 0x6affd0 : 0x6ad0ff) : 0x33507a);
      // tint pads ahead toward danger as risk rises (a readable gradient)
      const ahead = (p.mesh.position.z - this.tile * TILE) / TILE;
      if (ahead >= 0 && ahead < 6) {
        const danger = clamp((this.risk + ahead * RISK_STEP) / 100, 0, 1);
        p.mesh.material.emissive.setRGB(0.1 + danger * 0.8, 0.25 * (1 - danger), 0.5 * (1 - danger) + 0.05);
      }
    }

    // player colour shifts gold -> hot red as the next-hop risk climbs
    const r = this.risk / 100;
    this.pMat.emissive.setRGB(0.5 + r * 0.5, 0.42 * (1 - r * 0.6), 0.0);

    // camera chase
    const sh = this.shakeAmt; this.shakeAmt *= Math.pow(0.0001, dt);
    const camTarget = new THREE.Vector3(0, 6.5, this.tile * TILE - 9.5);
    this.camera.position.lerp(camTarget, 1 - Math.exp(-dt * 5));
    this.camera.position.x += (Math.random() - 0.5) * sh; this.camera.position.y += (Math.random() - 0.5) * sh;
    this.camera.lookAt(0, 0.5, this.tile * TILE + 4);

    this.sun.position.set(8, 20, this.tile * TILE + 6);
    this.sun.target.position.set(0, 0, this.tile * TILE); this.sun.target.updateMatrixWorld();

    this._updateFx(dt);
  }

  _burst(color, n) {
    const col = (color instanceof THREE.Color) ? color : new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const p = this.fx[this.fxCursor]; this.fxCursor = (this.fxCursor + 1) % this.fx.length;
      p.mesh.position.set(this.pos.x, this.pos.y + 1, this.pos.z);
      const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 7;
      p.vx = Math.cos(a) * sp; p.vz = Math.sin(a) * sp; p.vy = 3 + Math.random() * 6;
      p.life = 1; p.mesh.material.color.copy(col); p.mesh.material.opacity = 1;
      p.mesh.scale.setScalar(0.4 + Math.random() * 0.7); p.mesh.visible = true;
    }
  }
  _updateFx(dt) {
    for (const p of this.fx) {
      if (p.life <= 0) continue;
      p.life -= dt * 1.8; p.vy -= 16 * dt;
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
    this.hud.showResult(this.score, this.best, isBest, this.busted);
  }

  _loadBest() { try { return +localStorage.getItem('nerve.best') || 0; } catch { return 0; } }
  _saveBest(v) { try { localStorage.setItem('nerve.best', String(v)); } catch {} }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(w, h);
  }
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
