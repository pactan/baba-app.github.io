import * as THREE from 'three';
import { Station } from './base.js';
import { Stage } from '../stage.js';
import { M, rbox, lathe, knurled, clamp } from '../util.js';

// 04 — Slide. A heavy chrome bead riding a machined steel rail with turned
// end bumpers and detent collars at each notch. Drag the bead from the exact
// world point under the finger (zoom-independent); flick it and it glides on
// friction, then is magnetically eased into the nearest detent. A 'detent'
// click fires EXACTLY at each notch-center crossing (intensity ∝ speed); the
// turned end bumpers bounce with a 'thud'. The bead visibly ROLLS.
const DETENTS = 9;
const HALF = 1.65;                       // travel half-length (bead center)
const STEP = (HALF * 2) / (DETENTS - 1); // notch spacing
const BEAD_R = 0.30;
const RAIL_R = 0.052;                    // each guide rod radius
const RAIL_SEP = 0.20;                   // half the vertical gap between the rods
const RAIL_END = HALF + 0.40;            // rods extend past the bumpers
const RAIL_Y = 0.70;                     // rail centerline height

export class SlideStation extends Station {
  get title() { return 'Slide'; }
  get index() { return '04'; }
  frame() { return { y: 0.7, halfW: 2.3, halfH: 0.9 }; }

  build() {
    const steel = M.polishedSteel();
    const rodMat = M.polishedSteel();
    const collarMat = M.darkMetal(0x33373f);
    const bandMat = M.brass();

    // --- machined base block the rail mounts to ---
    const baseMat = M.alu(0xaeb4bd);
    const base = lathe([
      [0.0, 0.0], [0.55, 0.0], [0.55, 0.05], [0.5, 0.08], [0.5, 0.10], [0.0, 0.11],
    ], baseMat, 48);
    base.scale.set(1, 1, 0.62);            // squash into an oval footprint
    this.group.add(base);
    const plinth = new THREE.Mesh(rbox(HALF * 2 + 1.5, 0.16, 0.62, 0.07), baseMat);
    plinth.position.y = 0.08;
    plinth.castShadow = plinth.receiveShadow = true;
    this.group.add(plinth);

    // --- twin guide rods ---
    this.rods = [];
    for (const sy of [-1, 1]) {
      const rod = new THREE.Mesh(
        new THREE.CylinderGeometry(RAIL_R, RAIL_R, RAIL_END * 2, 40, 1), rodMat);
      rod.rotation.z = Math.PI / 2;
      rod.position.set(0, RAIL_Y + sy * RAIL_SEP, 0);
      rod.castShadow = rod.receiveShadow = true;
      this.group.add(rod);
      this.rods.push(rod);
    }

    // --- machined detent collars: a small turned cuff straddling both rods at
    // each notch, with a bright brass index band ---
    for (let i = 0; i < DETENTS; i++) {
      const x = this._detentX(i);
      const cuff = new THREE.Mesh(
        rbox(0.05, RAIL_SEP * 2 + RAIL_R * 2 + 0.04, 0.16, 0.018), collarMat);
      cuff.position.set(x, RAIL_Y, 0);
      cuff.castShadow = true;
      this.group.add(cuff);
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.018, RAIL_SEP * 2 + RAIL_R * 2 + 0.05, 0.17),
        bandMat);
      band.position.set(x, RAIL_Y, 0);
      this.group.add(band);
      // mid detent gets a slightly proud "home" pip
      if (i === (DETENTS - 1) / 2) {
        const pip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), bandMat);
        pip.position.set(x, RAIL_Y, 0.10);
        this.group.add(pip);
      }
    }

    // --- turned end bumpers + posts ---
    for (const s of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const cap = this._bumper(steel);
        cap.position.set(s * RAIL_END, RAIL_Y + sy * RAIL_SEP, 0);
        cap.rotation.z = s > 0 ? -Math.PI / 2 : Math.PI / 2;
        this.group.add(cap);
      }
      // a stout pillar tying the rod ends together and down to the plinth
      const post = lathe([
        [0.0, 0.0], [0.18, 0.0], [0.18, 0.04], [0.10, 0.07],
        [0.085, RAIL_Y - RAIL_SEP - 0.06], [0.10, RAIL_Y - RAIL_SEP],
        [0.10, RAIL_Y + RAIL_SEP], [0.085, RAIL_Y + RAIL_SEP + 0.04], [0.0, RAIL_Y + RAIL_SEP + 0.04],
      ], baseMat, 40);
      post.position.set(s * (HALF + 0.32), 0.14, 0);
      post.castShadow = true;
      this.group.add(post);
    }

    // --- the heavy chrome bead: a barrel with knurled grip band + grooves,
    // bores for both rods ---
    this.bead = new THREE.Group();
    const barrel = lathe([
      [0.0, -BEAD_R], [BEAD_R * 0.62, -BEAD_R * 0.86], [BEAD_R * 0.9, -BEAD_R * 0.5],
      [BEAD_R, -BEAD_R * 0.18], [BEAD_R * 0.92, 0.0], [BEAD_R, BEAD_R * 0.18],
      [BEAD_R * 0.9, BEAD_R * 0.5], [BEAD_R * 0.62, BEAD_R * 0.86], [0.0, BEAD_R],
    ], steel, 48);
    barrel.rotation.z = Math.PI / 2;       // lay the barrel along X
    barrel.castShadow = true;
    this.bead.add(barrel);
    // knurled equatorial grip ring
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(BEAD_R * 0.95, BEAD_R * 0.95, BEAD_R * 0.5, 64, 1, true),
      knurled(M.darkMetal(0x2f333b), 22, 0.006));
    grip.rotation.z = Math.PI / 2;
    this.bead.add(grip);
    // dark groove rings flanking the grip
    for (const s of [-1, 1]) {
      const groove = new THREE.Mesh(
        new THREE.TorusGeometry(BEAD_R * 0.94, 0.016, 12, 56), M.darkMetal(0x23262c));
      groove.rotation.y = Math.PI / 2;
      groove.position.x = s * BEAD_R * 0.28;
      this.bead.add(groove);
    }
    // polished bore lips where the rods pass through the ends
    for (const s of [-1, 1]) {
      const lip = new THREE.Mesh(
        new THREE.TorusGeometry(0.085, 0.02, 12, 32), M.darkMetal(0x1c1f24));
      lip.rotation.y = Math.PI / 2;
      lip.position.x = s * BEAD_R * 0.97;
      this.bead.add(lip);
    }
    this.bead.position.set(0, RAIL_Y, 0);
    this.group.add(this.bead);

    // --- generous invisible grab volume along the track ---
    const grab = new THREE.Mesh(
      new THREE.BoxGeometry(HALF * 2 + 1.0, 0.95, 0.95),
      new THREE.MeshBasicMaterial({ visible: false }));
    grab.position.set(0, RAIL_Y, 0);
    this.group.add(grab);
    this.interactive = [grab];

    this.group.add(Stage.contactShadow(HALF + 0.8, 0.42));

    // --- state ---
    this.x = this._detentX((DETENTS - 1) / 2);
    this.vx = 0;
    this.dragging = false;
    this.grabOffset = 0;
    this.lastT = 0;
    this.prevX = this.x;
    this.lastDetent = this._nearest(this.x);
    this._restingDetent = this.lastDetent;
    this.roll = null;
  }

  _bumper(mat) {
    return lathe([
      [0.0, 0.0], [RAIL_R + 0.01, 0.0], [0.09, 0.015], [0.10, 0.05],
      [0.095, 0.10], [0.075, 0.15], [0.04, 0.185], [0.0, 0.2],
    ], mat, 36);
  }

  _nearest(x) { return clamp(Math.round((x + HALF) / STEP), 0, DETENTS - 1); }
  _detentX(i) { return -HALF + i * STEP; }

  onDown(hit, ndc) {
    this.dragging = true;
    this.vx = 0;
    this.grabOffset = hit ? this.x - hit.point.x : 0;
    this.lastT = performance.now() / 1000;
    if (!this.roll) this.roll = this.ctx.feedback.sound.noiseTone({ freq: 300, q: 1.6, gain: 0 });
  }

  onMove(hit, ndc) {
    if (!this.dragging || !hit) return;
    const now = performance.now() / 1000;
    const dt = Math.max(1 / 240, now - this.lastT);
    const nx = clamp(hit.point.x + this.grabOffset, -HALF, HALF);
    const inst = (nx - this.x) / dt;
    this.vx = this.vx * 0.4 + inst * 0.6;     // smoothed velocity estimate
    this.x = nx;
    this.lastT = now;
  }

  onUp() { this.dragging = false; }

  onLeave() {
    if (this.roll) { this.roll.stop(); this.roll = null; }
    this.dragging = false;
    this.vx = 0;
  }

  update(dt) {
    if (this.ctx.settings.reducedMotion && !this.dragging) {
      const t = this._detentX(this._nearest(this.x));
      this.x += (t - this.x) * Math.min(1, dt * 25);
      this.vx = 0;
    } else if (!this.dragging) {
      // Friction glide.
      this.vx *= Math.pow(0.045, dt);
      this.x += this.vx * dt;

      // Magnetic ease into nearest detent once slow enough.
      if (Math.abs(this.vx) < 3.4) {
        const target = this._detentX(this._nearest(this.x));
        const pull = (target - this.x);
        this.x += pull * Math.min(1, dt * 16);
        this.vx += pull * dt * 42;
        if (Math.abs(pull) < 0.0025 && Math.abs(this.vx) < 0.05) {
          this.x = target; this.vx = 0;
        }
      }

      // End-stop bounce with a thud.
      if (this.x < -HALF) {
        this.x = -HALF;
        if (Math.abs(this.vx) > 1.2) this._endHit(Math.abs(this.vx));
        this.vx = Math.abs(this.vx) * 0.4;
      } else if (this.x > HALF) {
        this.x = HALF;
        if (Math.abs(this.vx) > 1.2) this._endHit(Math.abs(this.vx));
        this.vx = -Math.abs(this.vx) * 0.4;
      }
    }

    // Detent center-crossing: fire a click for every notch center swept this
    // step, exactly when the bead center passes it. Intensity scales with speed.
    const span = this.x - this.prevX;
    if (span !== 0) {
      const lo = Math.min(this.prevX, this.x), hi = Math.max(this.prevX, this.x);
      for (let i = 0; i < DETENTS; i++) {
        const c = this._detentX(i);
        if (c > lo + 1e-6 && c <= hi + 1e-6) {
          const sp = clamp(Math.abs(this.vx) / 8, 0, 1);
          this.ctx.feedback.emit({
            type: 'detent',
            intensity: 0.26 + 0.74 * sp,
            pitch: 1.04 + 0.16 * sp,
            pan: clamp(c / 2.2, -1, 1),
          });
        }
      }
    }
    this.prevX = this.x;

    // Apply transform + visible roll (rotation ∝ travel / radius).
    this.bead.position.x = this.x;
    this.bead.rotation.z -= span / BEAD_R;

    // Rolling noise: gain & pitch ∝ speed.
    if (this.roll) {
      const sp = clamp(Math.abs(this.vx) / 11, 0, 1);
      this.roll.setGain(sp * 0.11);
      this.roll.setFreq(280 + Math.abs(this.vx) * 46);
    }

    this._restingDetent = this._nearest(this.x);
    if (this._restingDetent !== this.lastDetent) {
      this.lastDetent = this._restingDetent;
      this.refreshStat();
    }
  }

  _endHit(speed) {
    this.ctx.feedback.emit({
      type: 'thud',
      intensity: clamp(0.4 + speed / 12, 0, 1),
      pan: clamp(this.x / 2.2, -1, 1),
    });
  }

  info() {
    const n = (this._restingDetent ?? this._nearest(this.x)) + 1;
    return `<span class="num">${n}</span>/${DETENTS}`;
  }
}
