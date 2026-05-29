import * as THREE from 'three';
import { Station } from './base.js';
import { Stage } from '../stage.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// 03 — Spin. A weighted tri-spinner with real angular physics: a hard flick
// spins for 10–30s. Continuous bearing whir rises with RPM; per-rev haptic
// only at low speed; motion ghost at high speed; tap-the-center to brake.
export class SpinStation extends Station {
  get title() { return 'Spin'; }
  get index() { return '03'; }
  frame() { return { y: 0.9, halfW: 1.3, halfH: 1.2 }; }

  build() {
    this.maxRpm = this.load('spin.maxrpm', 0);
    this.omega = 0;        // angular velocity (rad/s) about Z, faces camera
    this.angle = 0;
    this.dragging = false;
    this.braking = false;
    this.lastRev = 0;

    const metal = new THREE.MeshPhysicalMaterial({ color: 0xe9ebee, roughness: 0.3, metalness: 0.9 });
    const body = new THREE.MeshPhysicalMaterial({ color: 0xf2f3f5, roughness: 0.4, clearcoat: 0.7 });

    // Post + pivot, spinner faces the camera.
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 0.7, 32),
      new THREE.MeshPhysicalMaterial({ color: 0x2a2d34, roughness: 0.6 }));
    post.position.y = 0.35; post.castShadow = true;
    this.group.add(post);

    this.spinner = new THREE.Group();
    this.spinner.position.set(0, 0.9, 0);
    this.group.add(this.spinner);

    // Tri-spinner: center hub + 3 weighted arms.
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.16, 40), body);
    hub.rotation.x = Math.PI / 2; hub.castShadow = true;
    this.spinner.add(hub);
    const bearing = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.2, 32), metal);
    bearing.rotation.x = Math.PI / 2;
    this.spinner.add(bearing);

    for (let i = 0; i < 3; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = (i / 3) * Math.PI * 2;
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.6, 0.14), body);
      neck.position.y = 0.42; neck.castShadow = true;
      const weight = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.18, 36), metal);
      weight.rotation.x = Math.PI / 2; weight.position.y = 0.78; weight.castShadow = true;
      arm.add(neck); arm.add(weight);
      this.spinner.add(arm);
    }

    // Motion ghost — faint additive copy, shows speed.
    this.ghost = this.spinner.clone();
    this.ghost.traverse((o) => {
      if (o.isMesh) {
        o.material = new THREE.MeshBasicMaterial({ color: 0x9fc0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
        o.castShadow = false;
      }
    });
    this.group.add(this.ghost);

    // Big invisible disc so the whole area reliably catches the flick gesture.
    const grab = new THREE.Mesh(new THREE.CircleGeometry(1.3, 32), new THREE.MeshBasicMaterial({ visible: false }));
    grab.position.set(0, 0.9, 0.3);
    this.group.add(grab);
    this.interactive = [grab];

    this.group.add(Stage.contactShadow(1.4, 0.4));
    this.whir = null;
  }

  _ensureWhir() {
    if (!this.whir) this.whir = this.ctx.feedback.sound.tone({ type: 'sawtooth', freq: 60, gain: 0, lowpass: 900 });
  }

  onDown(hit, ndc) {
    this._ensureWhir();
    this.dragging = true;
    this.lastAngle = Math.atan2(ndc.y, ndc.x);
    this.lastT = performance.now() / 1000;
    this.vel = 0;
    // Finger near the center = brake.
    this.braking = Math.hypot(ndc.x, ndc.y) < 0.12;
    if (this.braking && !this.scrape) {
      this.scrape = this.ctx.feedback.sound.noiseTone({ freq: 1200, q: 0.7, gain: 0 });
    }
  }

  onMove(hit, ndc) {
    if (!this.dragging) return;
    this.braking = Math.hypot(ndc.x, ndc.y) < 0.12;
    const a = Math.atan2(ndc.y, ndc.x);
    const now = performance.now() / 1000;
    const dt = Math.max(1 / 240, now - this.lastT);
    const da = wrap(a - this.lastAngle);
    this.angle += da;          // follow the finger directly while dragging
    this.vel = da / dt;        // track release velocity
    this.lastAngle = a; this.lastT = now;
  }

  onUp() {
    if (this.dragging && !this.braking) {
      this.omega = Math.max(-90, Math.min(90, this.vel)); // hand off flick velocity
    }
    this.dragging = false;
    this.braking = false;
    if (this.scrape) { this.scrape.stop(); this.scrape = null; }
  }

  update(dt, t) {
    if (!this.dragging) {
      // Bearing friction: small constant term + drag proportional to speed.
      const sign = Math.sign(this.omega);
      const fr = (0.25 + 0.06 * Math.abs(this.omega)) * dt;
      if (Math.abs(this.omega) <= fr) this.omega = 0;
      else this.omega -= sign * fr;
      this.angle += this.omega * dt;
    } else if (this.braking) {
      this.omega *= Math.pow(0.02, dt); // strong decay while braking
    }

    this.spinner.rotation.z = this.angle;

    const rpm = Math.abs(this.omega) / (Math.PI * 2) * 60;
    if (rpm > this.maxRpm + 1) { this.maxRpm = Math.round(rpm); this.save('spin.maxrpm', this.maxRpm); }
    this.refreshStat();

    // Per-rev tick only at low speed; whir takes over when fast.
    const revs = this.angle / (Math.PI * 2 / 3); // each arm
    if (Math.abs(this.omega) > 0.4 && Math.abs(this.omega) < 8 && Math.floor(revs) !== this.lastRev) {
      this.lastRev = Math.floor(revs);
      this.ctx.feedback.emit({ type: 'detent', intensity: 0.2, pitch: 1.6 });
    } else {
      this.lastRev = Math.floor(revs);
    }

    // Whir + ghost scale with speed.
    if (this.whir) {
      const s = Math.min(1, rpm / 600);
      this.whir.setFreq(70 + rpm * 0.45);
      this.whir.setGain(s * 0.12);
    }
    if (this.scrape) this.scrape.setGain(this.braking ? Math.min(0.18, rpm / 1500) : 0);

    const ghostK = Math.min(1, Math.max(0, (rpm - 120) / 700));
    this.ghost.rotation.z = this.angle + 0.5;
    this.ghost.visible = ghostK > 0.02 && !this.ctx.settings.reducedMotion;
    this.ghost.traverse((o) => { if (o.isMesh) o.material.opacity = ghostK * 0.5; });
  }

  info() {
    const rpm = Math.round(Math.abs(this.omega) / (Math.PI * 2) * 60);
    return `<span class="num">${rpm}</span>rpm · best ${this.maxRpm}`;
  }
}
