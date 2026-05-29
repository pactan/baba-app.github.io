import * as THREE from 'three';
import { Station } from './base.js';
import { Stage } from '../stage.js';
import { rbox } from '../util.js';

// 09 — Lock. A 3-drum combination padlock. Each drum clicks per number with a
// detent and momentum — a flick spins through several numbers and settles.
// Modes: free (target shown), memory (peek then hidden), safecracker (no target;
// the click gets heavier as a digit nears correct, so you crack it by feel).
// Match unlocks: the shackle springs with a thunk, then the drums auto-scramble.
const DETENT = (Math.PI * 2) / 10;
const MODES = ['free', 'memory', 'safecracker'];

export class LockStation extends Station {
  get title() { return 'Lock'; }
  get index() { return '09'; }
  frame() { return { y: 1.1, halfW: 1.6, halfH: 1.5 }; }

  build() {
    this.mode = this.load('lock.mode', 'free');
    this.target = this._rand();
    this.peekUntil = 4;
    this.unlocked = false;
    this.shackleY = 0;

    const body = new THREE.MeshPhysicalMaterial({ color: 0xb9bdc4, roughness: 0.32, metalness: 1 });
    const drumMat = new THREE.MeshPhysicalMaterial({ color: 0x3a3d44, roughness: 0.4, metalness: 0.8 });

    // Padlock body.
    const shell = new THREE.Mesh(rbox(2.4, 1.5, 0.7, 0.16), body);
    shell.position.set(0, 0.95, 0); shell.castShadow = shell.receiveShadow = true;
    this.group.add(shell);

    // Shackle.
    this.shackle = new THREE.Group();
    const barL = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.1, 20), body);
    barL.position.set(-0.6, 0.55, 0);
    const barR = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 20), body);
    barR.position.set(0.6, 0.75, 0);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.12, 16, 24, Math.PI), body);
    arc.position.set(0, 1.1, 0);
    this.shackle.add(barL, barR, arc);
    this.shackle.position.y = 1.0;
    this.shackle.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.group.add(this.shackle);

    // Three drums with a digit window each.
    this.drums = [];
    this.interactive = [];
    // Drum geometry baked to lie along X so the dynamic spin is a pure rotation
    // about the world X axis (a clean roll), not a tumble.
    const drumGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.5, 40, 1);
    drumGeo.rotateZ(Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.62;
      const cyl = new THREE.Mesh(drumGeo, drumMat);
      cyl.position.set(x, 0.95, 0.36);
      cyl.castShadow = true;
      cyl.userData.idx = i;
      // knurl ridges around the X axis (in the Y-Z plane)
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.02), drumMat);
        ridge.position.y = 0.345 * Math.cos(a);
        ridge.position.z = 0.345 * Math.sin(a);
        ridge.rotation.x = a;
        cyl.add(ridge);
      }
      this.group.add(cyl);

      const tex = new DigitTex();
      const window = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), tex.material);
      window.position.set(x, 0.95, 0.71);
      this.group.add(window);

      this.drums.push({ cyl, tex, angle: 0, vel: 0, value: 0, x });
      this.interactive.push(cyl);
    }

    // Mode button.
    this.modeBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 20), drumMat);
    this.modeBtn.rotation.x = Math.PI / 2;
    this.modeBtn.position.set(0.95, 0.4, 0.36);
    this.modeBtn.userData.role = 'mode';
    this.group.add(this.modeBtn);

    this.group.add(Stage.contactShadow(1.6, 0.5));
    this.active = -1;
    this.t = 0;
    this._updateDigits();
  }

  _rand() { return [0, 0, 0].map(() => Math.floor(Math.random() * 10)); }

  onDown(hit, ndc) {
    if (hit?.object.userData.role === 'mode') {
      this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
      this.save('lock.mode', this.mode);
      this.peekUntil = this.t + 3;
      this.ctx.feedback.emit({ type: 'detent', intensity: 0.6 });
      this.refreshStat();
      this.active = -1;
      return;
    }
    const i = hit?.object.userData.idx;
    if (i == null || this.unlocked) { this.active = -1; return; }
    this.active = i;
    this.drums[i].vel = 0;
    this.lastY = ndc.y; this.lastT = performance.now() / 1000;
  }

  onMove(hit, ndc) {
    if (this.active < 0) return;
    const now = performance.now() / 1000;
    const dt = Math.max(1 / 240, now - this.lastT);
    const d = this.drums[this.active];
    const da = (ndc.y - this.lastY) * 5;
    d.angle += da;
    d.vel = da / dt;
    this.lastY = ndc.y; this.lastT = now;
  }

  onUp() { this.active = -1; }

  _valueOf(d) { return ((Math.round(d.angle / DETENT) % 10) + 10) % 10; }

  update(dt, t) {
    this.t += dt;
    for (let i = 0; i < 3; i++) {
      const d = this.drums[i];
      const dragging = this.active === i;
      if (!dragging && !this.unlocked) {
        d.vel *= Math.pow(0.05, dt);
        d.angle += d.vel * dt;
        if (Math.abs(d.vel) < 4) {
          const snap = Math.round(d.angle / DETENT) * DETENT;
          d.angle += (snap - d.angle) * Math.min(1, dt * 16);
          if (Math.abs(snap - d.angle) < 0.002) { d.angle = snap; d.vel = 0; }
        }
      }
      d.cyl.rotation.x = d.angle;

      const v = this._valueOf(d);
      if (v !== d.value) {
        d.value = v;
        d.tex.draw(v);
        this._detentClick(i, d, v);
        if (!this.unlocked) this._checkUnlock();
      }
    }

    // Shackle spring on unlock.
    const targetY = this.unlocked ? 0.9 : 0.0;
    this.shackleY += (targetY - this.shackleY) * Math.min(1, dt * 8);
    this.shackle.position.y = 1.0 + this.shackleY;
    this.shackle.rotation.y = this.unlocked ? this.shackleY * 1.2 : 0;

    if (this.t < this.peekUntil) this.refreshStat();
  }

  _detentClick(i, d, v) {
    let intensity = 0.5, pitch = 1.1, type = 'detent';
    if (this.mode === 'safecracker' && !this.unlocked) {
      const dist = Math.min(Math.abs(v - this.target[i]), 10 - Math.abs(v - this.target[i]));
      if (dist === 0) { intensity = 1; pitch = 0.7; type = 'ratchet-heavy'; }
      else if (dist === 1) { intensity = 0.75; pitch = 0.9; }
    }
    this.ctx.feedback.emit({ type, intensity, pitch, pan: d.x / 3 });
  }

  _checkUnlock() {
    if (this.drums.every((d, i) => d.value === this.target[i])) {
      this.unlocked = true;
      this.ctx.feedback.emit({ type: 'unlock', intensity: 1 });
      setTimeout(() => this.ctx.feedback.emit({ type: 'thud', intensity: 0.9 }), 180);
      this.refreshStat();
      setTimeout(() => this._scramble(), 1600);
    }
  }

  _scramble() {
    this.target = this._rand();
    this.peekUntil = this.t + 3;
    for (const d of this.drums) { d.vel = (Math.random() - 0.5) * 60; }
    this.unlocked = false;
    this.refreshStat();
  }

  _updateDigits() { for (const d of this.drums) d.tex.draw(d.value); }

  info() {
    if (this.unlocked) return '🔓 OPEN';
    const show = this.mode === 'free' || (this.mode === 'memory' && this.t < this.peekUntil);
    const t = show ? this.target.join(' ') : '· · ·';
    return `${this.mode} · ${t}`;
  }
}

class DigitTex {
  constructor() {
    this.cv = document.createElement('canvas');
    this.cv.width = this.cv.height = 128;
    this.g = this.cv.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.cv);
    this.material = new THREE.MeshBasicMaterial({ map: this.tex });
    this.draw(0);
  }
  draw(v) {
    const g = this.g;
    g.fillStyle = '#1b1d22'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#f4f5f7';
    g.font = '700 86px ui-monospace, Menlo, monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(v), 64, 70);
    this.tex.needsUpdate = true;
  }
}
