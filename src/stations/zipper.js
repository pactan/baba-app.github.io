import * as THREE from 'three';
import { Station } from './base.js';
import { Stage } from '../stage.js';

// 11 — Zipper (new). Drag the pull up the track: teeth above it mesh together
// (closed), teeth below split apart (open). Every tooth the slider crosses fires
// a tick; zip fast and they blur into a rising buzz. Zipping up vs down shifts
// the pitch. End-stops thunk.
const TEETH = 20;
const TOP = 2.0, BOTTOM = 0.2;
const SPAN = TOP - BOTTOM;
const STEP = SPAN / TEETH;

export class ZipperStation extends Station {
  get title() { return 'Zipper'; }
  get index() { return '11'; }

  build() {
    this.pullY = BOTTOM;     // start fully open
    this.vel = 0;
    this.dragging = false;
    this.lastCrossed = 0;

    const tape = new THREE.MeshPhysicalMaterial({ color: 0x2f3a52, roughness: 0.85 });
    const toothMat = new THREE.MeshPhysicalMaterial({ color: 0xd9dde3, roughness: 0.25, metalness: 1 });
    this.toothMat = toothMat;

    // Two fabric tapes.
    for (const s of [-1, 1]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.34, SPAN + 0.5, 0.06), tape);
      t.position.set(s * 0.32, (TOP + BOTTOM) / 2, -0.05);
      t.receiveShadow = true; t.castShadow = true;
      this.group.add(t);
    }

    // Teeth — one per side per row, animated between meshed and split.
    this.teeth = [];
    for (let i = 0; i < TEETH; i++) {
      const y = BOTTOM + i * STEP + STEP / 2;
      const row = [];
      for (const s of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, STEP * 0.7, 0.12), toothMat);
        m.castShadow = true;
        this.group.add(m);
        row.push({ mesh: m, side: s });
      }
      this.teeth.push({ y, row });
    }

    // The slider/pull.
    this.pull = new THREE.Group();
    const slider = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.26), toothMat);
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.05),
      new THREE.MeshPhysicalMaterial({ color: 0xc7ccd4, roughness: 0.3, metalness: 1 }));
    tab.position.y = -0.28;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 10, 20), tab.material);
    ring.position.y = -0.12;
    this.pull.add(slider, tab, ring);
    this.group.add(this.pull);

    // Grab volume covers the whole track.
    const grab = new THREE.Mesh(new THREE.BoxGeometry(1.0, SPAN + 0.6, 0.5), new THREE.MeshBasicMaterial({ visible: false }));
    grab.position.set(0, (TOP + BOTTOM) / 2, 0.1);
    this.group.add(grab);
    this.interactive = [grab];

    this.group.add(Stage.contactShadow(1.2, 0.4));
    this.buzz = null;
  }

  _ndcToY(ndc) {
    // Map the visible vertical band to the track range. Camera looks at y≈0.35,
    // so use a generous mapping and clamp.
    return Math.max(BOTTOM, Math.min(TOP, (TOP + BOTTOM) / 2 + ndc.y * 2.0));
  }

  onDown(hit, ndc) {
    this.dragging = true;
    this.vel = 0;
    this.grabOffset = this.pullY - this._ndcToY(ndc);
    this.lastT = performance.now() / 1000;
    if (!this.buzz) this.buzz = this.ctx.feedback.sound.noiseTone({ freq: 2200, q: 1.5, gain: 0 });
  }

  onMove(hit, ndc) {
    if (!this.dragging) return;
    const now = performance.now() / 1000;
    const dt = Math.max(1 / 240, now - this.lastT);
    const ny = Math.max(BOTTOM, Math.min(TOP, this._ndcToY(ndc) + this.grabOffset));
    this.vel = (ny - this.pullY) / dt;
    this.pullY = ny;
    this.lastT = now;
  }

  onUp() { this.dragging = false; }

  update(dt) {
    if (!this.dragging) {
      this.vel *= Math.pow(0.02, dt);
      this.pullY += this.vel * dt;
      if (this.pullY <= BOTTOM) { this.pullY = BOTTOM; if (this.vel < -0.5) this._end(); this.vel = 0; }
      if (this.pullY >= TOP) { this.pullY = TOP; if (this.vel > 0.5) this._end(); this.vel = 0; }
    }

    this.pull.position.set(0, this.pullY, 0.18);

    // Tooth crossings => zip ticks. Pitch shifts with zip direction.
    const crossed = Math.round((this.pullY - BOTTOM) / STEP);
    if (crossed !== this.lastCrossed) {
      const up = crossed > this.lastCrossed;
      const sp = Math.min(1, Math.abs(this.vel) / 6);
      this.ctx.feedback.emit({ type: 'zip', intensity: 0.2 + 0.6 * sp, pitch: (up ? 1.3 : 1.0) + crossed * 0.015 });
      this.lastCrossed = crossed;
    }

    // Teeth mesh above the pull, split below.
    for (const t of this.teeth) {
      const closed = t.y < this.pullY ? 1 : 0; // below the slider's travel = already zipped
      const k = Math.max(0, Math.min(1, (this.pullY - t.y) / STEP + 0.5));
      for (const tooth of t.row) {
        const openX = tooth.side * 0.3;
        const closeX = tooth.side * 0.07;
        tooth.mesh.position.set(THREE.MathUtils.lerp(openX, closeX, k), t.y, 0);
        tooth.mesh.position.z = 0;
      }
    }

    if (this.buzz) {
      const sp = Math.min(1, Math.abs(this.vel) / 8);
      this.buzz.setGain(sp * 0.08);
      this.buzz.setFreq(1800 + Math.abs(this.vel) * 250);
    }
  }

  _end() { this.ctx.feedback.emit({ type: 'thud', intensity: 0.6 }); }

  info() {
    const pct = Math.round((this.pullY - BOTTOM) / SPAN * 100);
    return `${pct}% zipped`;
  }
}
