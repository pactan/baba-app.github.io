import * as THREE from 'three';
import { Station } from './base.js';
import { Stage } from '../stage.js';

// 04 — Slide. A metal bead on a detented track. Flick it: it glides, decelerates
// with friction, and eases magnetically into the nearest detent. The click fires
// exactly at the center-crossing. End-stops bounce.
const DETENTS = 9;
const HALF = 1.7;                // track half-length
const STEP = (HALF * 2) / (DETENTS - 1);

export class SlideStation extends Station {
  get title() { return 'Slide'; }
  get index() { return '04'; }
  frame() { return { y: 0.65, halfW: 2.3, halfH: 0.9 }; }

  build() {
    const metal = new THREE.MeshPhysicalMaterial({ color: 0xd9dde3, roughness: 0.18, metalness: 1.0 });

    // Rail.
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, HALF * 2 + 0.4, 24),
      new THREE.MeshPhysicalMaterial({ color: 0xb8bcc4, roughness: 0.25, metalness: 1 }));
    rail.rotation.z = Math.PI / 2; rail.position.y = 0.6; rail.castShadow = true;
    this.group.add(rail);

    // Detent notches (little rings) + end caps.
    for (let i = 0; i < DETENTS; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 8, 24), metal);
      ring.position.set(-HALF + i * STEP, 0.6, 0);
      this.group.add(ring);
    }
    for (const s of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 16), metal);
      cap.position.set(s * (HALF + 0.2), 0.6, 0); cap.castShadow = true;
      this.group.add(cap);
    }

    this.bead = new THREE.Mesh(new THREE.SphereGeometry(0.24, 36, 24), metal);
    this.bead.position.set(0, 0.6, 0); this.bead.castShadow = true;
    this.group.add(this.bead);

    // Generous invisible grab volume along the track.
    const grab = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 0.8, 0.7, 0.7), new THREE.MeshBasicMaterial({ visible: false }));
    grab.position.set(0, 0.6, 0);
    this.group.add(grab);
    this.interactive = [grab];

    this.group.add(Stage.contactShadow(HALF + 0.5, 0.4));

    this.x = 0; this.vx = 0;
    this.dragging = false;
    this.lastDetent = this._nearest(0);
    this.roll = null;
  }

  _nearest(x) { return Math.round((x + HALF) / STEP); }
  _detentX(i) { return -HALF + i * STEP; }

  onDown(hit, ndc) {
    this.dragging = true;
    this.vx = 0;
    // Grab from the exact world point under the finger.
    this.grabOffset = hit ? this.x - hit.point.x : 0;
    this.lastT = performance.now() / 1000;
    if (!this.roll) this.roll = this.ctx.feedback.sound.noiseTone({ freq: 320, q: 1.4, gain: 0 });
  }

  onMove(hit, ndc) {
    if (!this.dragging || !hit) return;
    const now = performance.now() / 1000;
    const dt = Math.max(1 / 240, now - this.lastT);
    const nx = Math.max(-HALF, Math.min(HALF, hit.point.x + this.grabOffset));
    this.vx = (nx - this.x) / dt;
    this.x = nx;
    this.lastT = now;
  }

  onUp() { this.dragging = false; }

  update(dt) {
    if (!this.dragging) {
      // Friction glide.
      this.vx *= Math.pow(0.06, dt);
      this.x += this.vx * dt;

      // Magnetic pull toward the nearest detent when slow.
      if (Math.abs(this.vx) < 3) {
        const target = this._detentX(this._nearest(this.x));
        this.x += (target - this.x) * Math.min(1, dt * 14);
        if (Math.abs(target - this.x) < 0.003) { this.x = target; this.vx = 0; }
      }

      // End-stops bounce.
      if (this.x < -HALF) { this.x = -HALF; this.vx = Math.abs(this.vx) * 0.45; if (Math.abs(this.vx) > 1) this._endHit(); }
      if (this.x > HALF) { this.x = HALF; this.vx = -Math.abs(this.vx) * 0.45; if (Math.abs(this.vx) > 1) this._endHit(); }
    }

    // Detent center-crossing => click, intensity scales with speed.
    const d = this._nearest(this.x);
    if (d !== this.lastDetent) {
      this.lastDetent = d;
      const sp = Math.min(1, Math.abs(this.vx) / 8);
      this.ctx.feedback.emit({ type: 'detent', intensity: 0.3 + 0.7 * sp, pitch: 1.1, pan: this.x / 3 });
    }

    this.bead.position.x = this.x;
    this.bead.rotation.z -= (this.dragging ? this.vx : this.vx) * dt / 0.24; // roll
    if (this.roll) {
      const sp = Math.min(1, Math.abs(this.vx) / 10);
      this.roll.setGain(sp * 0.1);
      this.roll.setFreq(300 + Math.abs(this.vx) * 40);
    }
  }

  _endHit() {
    this.ctx.feedback.emit({ type: 'thud', intensity: 0.8, pan: this.x / 3 });
  }

  info() { return `detents`; }
}
