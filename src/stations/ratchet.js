import * as THREE from 'three';
import { Station } from './base.js';
import { Spring } from '../spring.js';
import { Stage } from '../stage.js';
import { rbox } from '../util.js';

// 07 — Ratchet (the hero). A socket wrench tightening a hex bolt.
//   Clockwise = ENGAGED: socket grips, bolt turns with the wrench, torque builds,
//     each pawl click advances the bolt. Clicks thicken from a light metallic tick
//     to a heavy clunk as torque rises (harder, slower, lower-pitched).
//   Counter-clockwise = FREE-SPIN: the classic "rrrrt" — fast light clicks, the
//     wrench slips over the static bolt, no progress.
// At max torque, two modes:
//   limit  (default): bolt SEATS with a deep clunk; the wrench cams over (slips) so
//                     you can't over-tighten; a fresh bolt slides in.
//   destruct        : keep forcing and the head SNAPS off with a crack + debris.
const MAX = 1.0;
const CLICKS_TO_MAX = 16;
const INC = MAX / CLICKS_TO_MAX;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class RatchetStation extends Station {
  get title() { return 'Ratchet'; }
  get index() { return '07'; }
  frame() { return { y: 1.0, halfW: 2.7, halfH: 1.6 }; }

  build() {
    this.seated = this.load('ratchet.seated', 0);
    this.mode = this.load('ratchet.mode', 'limit'); // 'limit' | 'destruct'
    this.torque = 0;
    this.boltAngle = 0;
    this.wrenchAngle = 0;
    this.tightenAccum = 0;
    this.freeAccum = 0;
    this.forceAccum = 0;
    this.dragging = false;
    this.camKick = new Spring(260, 16, 0);

    const steel = new THREE.MeshPhysicalMaterial({ color: 0xc7ccd4, roughness: 0.28, metalness: 1 });
    const darkSteel = new THREE.MeshPhysicalMaterial({ color: 0x6b7079, roughness: 0.4, metalness: 1 });
    const boltMat = new THREE.MeshPhysicalMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 1 });
    this.boltMat = boltMat;

    // Work-plate the bolt threads into.
    const plate = new THREE.Mesh(rbox(3.2, 2.0, 0.4, 0.14),
      new THREE.MeshPhysicalMaterial({ color: 0x2c2f36, roughness: 0.7, metalness: 0.4 }));
    plate.position.set(0, 1.0, -0.2); plate.receiveShadow = true; plate.castShadow = true;
    this.group.add(plate);

    // Current bolt — hex head + shaft, axis along Z (faces camera).
    this.boltGroup = new THREE.Group();
    this.boltGroup.position.set(0, 1.0, 0);
    this.group.add(this.boltGroup);
    this._makeBolt(this.boltGroup, boltMat);

    // Wrench: round socket head over the bolt + a long handle, rotates about Z.
    this.wrench = new THREE.Group();
    this.wrench.position.set(0, 1.0, 0.34);
    this.group.add(this.wrench);
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 6), darkSteel);
    socket.rotation.x = Math.PI / 2; socket.castShadow = true;
    this.wrench.add(socket);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.12, 16, 40), steel);
    ring.castShadow = true; this.wrench.add(ring);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.22, 0.18), steel);
    handle.position.x = 1.15; handle.castShadow = true;
    // knurled grip
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, 0.24), darkSteel);
    grip.position.x = 1.75; this.wrench.add(grip);
    this.wrench.add(handle);

    // Analog torque gauge (top-left).
    this.gaugeSpan = Math.PI * 1.2;
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 48),
      new THREE.MeshStandardMaterial({ color: 0x12141a, roughness: 0.6 }));
    dial.rotation.x = Math.PI / 2;
    dial.position.set(-1.9, 2.1, 0.08); this.group.add(dial);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 12, 48), steel);
    rim.position.copy(dial.position); this.group.add(rim);
    this.needle = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.025, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xff5a5a, emissive: 0xff3030, emissiveIntensity: 0.4 }));
    this.needlePivot = new THREE.Group();
    this.needlePivot.position.copy(dial.position).add(new THREE.Vector3(0, 0, 0.05));
    this.needle.position.x = 0.18;
    this.needlePivot.add(this.needle);
    this.group.add(this.needlePivot);

    // Mode toggle button on the base.
    this.modeBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 24), darkSteel);
    this.modeBtn.rotation.x = Math.PI / 2;
    this.modeBtn.position.set(1.7, 2.1, 0.1);
    this.modeBtn.userData.role = 'mode';
    this.group.add(this.modeBtn);
    this.modeLed = new THREE.MeshStandardMaterial({ color: 0x222, emissive: 0xffaa33, emissiveIntensity: 0.6 });
    const ledRing = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.02, 8, 28), this.modeLed);
    ledRing.position.copy(this.modeBtn.position); this.group.add(ledRing);

    // Seated-bolt progress row.
    this.progressRow = new THREE.Group();
    this.progressRow.position.set(-1.5, 0.25, 0.3);
    this.group.add(this.progressRow);
    this._rebuildProgress();

    // Debris pool for the destruct snap.
    this.debris = new DebrisPool(this.group, 16);

    // Invisible grab disc routes the rotational gesture to the wrench.
    const grab = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32), new THREE.MeshBasicMaterial({ visible: false }));
    grab.position.set(0, 1.0, 0.5);
    grab.userData.role = 'wrench';
    this.group.add(grab);
    this.interactive = [grab, this.modeBtn];

    this.group.add(Stage.contactShadow(1.8, 0.5));
    this._setModeColor();
  }

  _makeBolt(parent, mat) {
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.34, 6), mat);
    head.rotation.x = Math.PI / 2; head.position.z = 0.18; head.castShadow = true;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.8, 20), mat);
    shaft.rotation.x = Math.PI / 2; shaft.position.z = -0.3;
    parent.add(head); parent.add(shaft);
    parent.userData.head = head;
    parent.userData.baseZ = 0;
  }

  _rebuildProgress() {
    this.progressRow.clear();
    const n = Math.min(this.seated, 10);
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 6),
        new THREE.MeshStandardMaterial({ color: 0x59d98a, emissive: 0x1d5a36, emissiveIntensity: 0.3, metalness: 0.6, roughness: 0.4 }));
      b.rotation.x = Math.PI / 2; b.position.x = i * 0.28;
      this.progressRow.add(b);
    }
  }

  _setModeColor() {
    this.modeLed.emissive.set(this.mode === 'destruct' ? 0xff3b3b : 0xffaa33);
  }

  onDown(hit, ndc) {
    if (hit?.object.userData.role === 'mode') {
      this.mode = this.mode === 'limit' ? 'destruct' : 'limit';
      this.save('ratchet.mode', this.mode);
      this._setModeColor();
      this.ctx.feedback.emit({ type: 'detent', intensity: 0.6 });
      this.refreshStat();
      this.pendingMode = true;
      return;
    }
    this.pendingMode = false;
    this.dragging = true;
    this.lastAngle = Math.atan2(ndc.y, ndc.x);
  }

  onMove(hit, ndc) {
    if (!this.dragging) return;
    const a = Math.atan2(ndc.y, ndc.x);
    const da = wrap(a - this.lastAngle);
    this.lastAngle = a;
    if (Math.abs(da) < 1e-4) return;
    this.wrenchAngle += da; // handle always follows the finger

    if (da < 0) this._tighten(-da);   // clockwise => engaged
    else this._freeSpin(da);          // ccw => free-spin rattle
  }

  onUp() { this.dragging = false; }

  _tighten(amount) {
    if (this.snapping || this.swapping) return;
    this.boltAngle -= amount;          // bolt turns WITH the wrench
    this.tightenAccum += amount;
    const step = 0.16 + 0.55 * (this.torque / MAX); // more rotation per click as it fights back
    while (this.tightenAccum >= step) {
      this.tightenAccum -= step;
      this._pawlClick();
      if (this.torque >= MAX) {
        if (this.mode === 'limit') { this._seat(); break; }
        else { this.forceAccum += 1; if (this.forceAccum >= 3) { this._snap(); break; } }
      }
    }
  }

  _pawlClick() {
    if (this.torque < MAX) this.torque = Math.min(MAX, this.torque + INC);
    const tq = this.torque / MAX;
    const heavy = tq > 0.55;
    this.ctx.feedback.emit({
      type: heavy ? 'ratchet-heavy' : 'ratchet-tick',
      intensity: 0.3 + 0.7 * tq,
      pitch: 1.5 - 0.8 * tq,            // lower-pitched as torque builds
    });
    this.camKick.set(0); this.camKick.v = 0.05 + 0.15 * tq; // bolt visibly fights back
  }

  _freeSpin(amount) {
    if (this.snapping || this.swapping) return;
    this.freeAccum += amount;
    while (this.freeAccum >= 0.16) {
      this.freeAccum -= 0.16;
      this.ctx.feedback.emit({ type: 'ratchet-tick', intensity: 0.18, pitch: 1.7 }); // fast light rattle
    }
  }

  _seat() {
    this.ctx.feedback.emit({ type: 'seat', intensity: 1 });
    this.camKick.set(0); this.camKick.v = 0.9; // cam-over slip
    this.seated++; this.save('ratchet.seated', this.seated);
    this._rebuildProgress(); this.refreshStat();
    this._swapBolt(false);
  }

  _snap() {
    this.snapping = true;
    this.ctx.feedback.emit({ type: 'snap', intensity: 1 });
    const head = this.boltGroup.userData.head;
    if (!this.ctx.settings.reducedMotion) {
      const p = this.boltGroup.localToWorld(head.position.clone());
      this.debris.burst(this.group.worldToLocal(p));
    }
    head.visible = false;
    this.seated++; this.save('ratchet.seated', this.seated); // counts as a (destroyed) bolt
    setTimeout(() => { head.visible = true; this._swapBolt(true); this.snapping = false; }, 350);
  }

  _swapBolt(fromSnap) {
    this.swapping = true;
    this.torque = 0; this.tightenAccum = 0; this.forceAccum = 0;
    this.boltSlide = new Spring(180, 16, 1); this.boltSlide.set(0); // 1 = off-screen, 0 = seated
    setTimeout(() => { this.swapping = false; }, 250);
  }

  update(dt, t) {
    const kick = this.camKick.update(dt);
    this.wrench.rotation.z = this.wrenchAngle + kick * 0.15;
    this.boltGroup.rotation.z = this.boltAngle;

    // Threads sink as torque rises.
    let z = -this.torque * 0.14;
    if (this.boltSlide) {
      const s = this.boltSlide.update(dt);
      this.boltGroup.position.y = 1.0 + s * 2.2;     // slides down from above
      this.boltGroup.rotation.z = this.boltAngle + s * 6;
      if (this.boltSlide.atRest) { this.boltSlide = null; this.boltAngle = 0; }
    } else {
      this.boltGroup.position.y = 1.0;
    }
    this.boltGroup.position.z = z;

    // Gauge needle climbs and quivers near max.
    const tq = this.torque / MAX;
    let na = this.gaugeSpan * (tq - 0.5);
    if (tq > 0.8 && !this.swapping) na += (Math.random() - 0.5) * 0.12 * (tq - 0.8) * 5;
    this.needlePivot.rotation.z = -na;
    this.needle.material.emissiveIntensity = 0.3 + tq * 1.2;

    this.debris.update(dt);
  }

  info() {
    return `<span class="num">${this.seated}</span>bolts · ${this.mode}`;
  }
}

// Small 3D debris burst for the destruct snap.
class DebrisPool {
  constructor(parent, n) {
    this.items = [];
    const geo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 1, roughness: 0.4 });
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false; parent.add(m);
      this.items.push({ mesh: m, v: new THREE.Vector3(), life: 0, spin: new THREE.Vector3() });
    }
  }
  burst(center) {
    for (const it of this.items) {
      it.mesh.position.copy(center);
      it.v.set((Math.random() - 0.5) * 5, Math.random() * 5 + 1, (Math.random() - 0.5) * 3 + 2);
      it.spin.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
      it.life = 0.9; it.mesh.visible = true;
    }
  }
  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      it.v.y -= 14 * dt;
      it.mesh.position.addScaledVector(it.v, dt);
      it.mesh.rotation.x += it.spin.x * dt;
      it.mesh.rotation.y += it.spin.y * dt;
      if (it.life <= 0) it.mesh.visible = false;
    }
  }
}
