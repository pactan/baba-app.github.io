import * as THREE from 'three';
import { Station } from './base.js';
import { Spring } from '../spring.js';
import { Stage } from '../stage.js';
import { M, rbox, lathe, hexBolt, screwHead, knurled, clamp } from '../util.js';

// 07 — Ratchet (THE HERO). A machined socket wrench tightening a hex bolt.
//
//   Clockwise drag  = ENGAGED: the socket grips the hex head, the bolt turns WITH
//     the wrench, torque builds, and each pawl click ADVANCES the bolt one notch.
//     Clicks thicken from a light high 'ratchet-tick' to a heavy low
//     'ratchet-heavy' as torque rises — and need MORE rotation per click the
//     harder the joint fights back. The threads visibly sink into the work-plate.
//   Counter-clockwise = FREE-SPIN: the classic fast "rrrrt" rattle. The pawl
//     skips, the wrench slips over the static bolt, NO progress.
//
//   At max torque, two persisted modes (mode button toggles):
//     'limit' (default): the bolt SEATS with a deep clunk, the wrench CAMS OVER
//        (a quick slip kick) and a fresh bolt feeds in from above.
//     'destruct'       : keep forcing past the limit and the head SNAPS off with
//        a sharp crack + metal debris, then a new bolt feeds in.
//
//   Live analog torque GAUGE: turned bezel + dark face + a red needle that climbs
//   and QUIVERS near the redline. A row of seated bolts shows lifetime progress.

const MAX = 1.0;
const CLICKS_TO_MAX = 16;
const INC = MAX / CLICKS_TO_MAX;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const BOLT_Y = 1.0;            // hex-bolt axis height (= frame.y)
const PLATE_Z = -0.18;

export class RatchetStation extends Station {
  get title() { return 'Ratchet'; }
  get index() { return '07'; }
  frame() { return { y: 1.0, halfW: 2.7, halfH: 1.6 }; }

  build() {
    this.seated = this.load('ratchet.seated', 0);
    this.mode = this.load('ratchet.mode', 'limit'); // 'limit' | 'destruct'

    this.torque = 0;
    this.boltAngle = 0;        // current bolt rotation about Z
    this.wrenchAngle = 0;      // handle rotation about Z (always follows finger)
    this.tightenAccum = 0;     // rotation banked toward the next engaged click
    this.freeAccum = 0;        // rotation banked toward the next free-spin rattle
    this.forceAccum = 0;       // over-torque clicks in destruct mode
    this.dragging = false;
    this.snapping = false;
    this.swapping = false;
    this.boltSlide = null;

    // Springs: a cam-over slip kick + a quiver/recoil for the bolt fighting back.
    this.camKick = new Spring(240, 14, 0);
    this.recoil = new Spring(320, 18, 0);

    // ---- materials ---------------------------------------------------------
    const chrome = M.polishedSteel();
    const gun = M.darkMetal(0x2b2f36);
    const gunLite = M.darkMetal(0x3a3f48);
    this.boltMat = M.alu(0x9aa1ab);
    const plateMat = M.darkMetal(0x23262c); plateMat.roughness = 0.62;
    const faceMat = new THREE.MeshStandardMaterial({ color: 0x0c0e13, roughness: 0.55, metalness: 0.2 });

    // ---- work-plate the bolt threads into --------------------------------
    const plate = new THREE.Mesh(rbox(3.3, 2.05, 0.42, 0.12), plateMat);
    plate.position.set(0, BOLT_Y, PLATE_Z - 0.21);
    plate.receiveShadow = plate.castShadow = true;
    this.group.add(plate);
    // counterbore boss the bolt seats against
    const boss = lathe([
      [0, 0], [0.5, 0], [0.5, 0.1], [0.46, 0.14], [0.3, 0.14], [0.3, 0.04], [0, 0.04],
    ], M.darkMetal(0x2e323a));
    boss.rotation.x = -Math.PI / 2;
    boss.position.set(0, BOLT_Y, PLATE_Z + 0.02);
    this.group.add(boss);
    // four corner fasteners on the plate
    for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const s = screwHead(0.09, M.darkMetal(0x4a4f58));
      s.position.set(sx * 1.42, BOLT_Y + sy * 0.84, PLATE_Z + 0.0);
      this.group.add(s);
    }

    // ---- the bolt (hex head + threaded shaft) ----------------------------
    this.boltGroup = new THREE.Group();
    this.boltGroup.position.set(0, BOLT_Y, 0);
    this.group.add(this.boltGroup);
    this._makeBolt(this.boltGroup, this.boltMat);

    // ---- the socket wrench ------------------------------------------------
    // Pivots about Z at (0, BOLT_Y, ~0.34): a turned round head housing a hex
    // socket, a tapered neck, a long handle and a knurled grip.
    this.wrench = new THREE.Group();
    this.wrench.position.set(0, BOLT_Y, 0.34);
    this.group.add(this.wrench);

    // Round ratchet head: a turned disc with a beveled rim + a selector nub.
    const headProfile = [
      [0, 0], [0.55, 0], [0.58, 0.04], [0.58, 0.18], [0.55, 0.22],
      [0.5, 0.24], [0.18, 0.24], [0.18, 0.05], [0, 0.05],
    ];
    const ratHead = lathe(headProfile, chrome, 56);
    ratHead.rotation.x = -Math.PI / 2;          // disc faces +Z, thin in Z
    ratHead.position.z = 0;
    this.wrench.add(ratHead);
    // back cap of the head
    const headBack = lathe([[0, 0], [0.55, 0], [0.55, 0.06], [0, 0.06]], gun, 48);
    headBack.rotation.x = Math.PI / 2;
    headBack.position.z = -0.02;
    this.wrench.add(headBack);
    // direction-selector nub on the head face
    const sel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 16), gunLite);
    sel.rotation.x = Math.PI / 2; sel.position.set(0.0, -0.32, 0.27);
    this.wrench.add(sel);

    // Hex socket sleeve that visibly fits over the hex bolt head.
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.34, 6), gun);
    socket.rotation.x = Math.PI / 2; socket.position.z = 0.0; socket.castShadow = true;
    this.wrench.add(socket);
    // socket inner bore (slightly recessed dark hex so you read it as hollow)
    const bore = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.8, metalness: 0.3 }));
    bore.rotation.x = Math.PI / 2; bore.position.z = 0.14;
    this.wrench.add(bore);

    // Tapered neck from head to handle.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.7, 20), chrome);
    neck.rotation.z = Math.PI / 2; neck.position.set(0.55, 0, 0); neck.castShadow = true;
    this.wrench.add(neck);

    // Handle: a flattened oval bar with a top reinforcing rib.
    const handle = new THREE.Mesh(rbox(1.55, 0.2, 0.32, 0.09), chrome);
    handle.position.set(1.55, 0, 0); handle.castShadow = true;
    this.wrench.add(handle);
    const rib = new THREE.Mesh(rbox(1.3, 0.07, 0.16, 0.03), gunLite);
    rib.position.set(1.5, 0.12, 0);
    this.wrench.add(rib);

    // Knurled rubber-over-steel grip with end cap.
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.19, 0.95, 28),
      knurled(M.darkMetal(0x26292f), 10, 0.006));
    grip.rotation.z = Math.PI / 2; grip.position.set(2.25, 0, 0); grip.castShadow = true;
    this.wrench.add(grip);
    const endCap = lathe([[0, 0], [0.2, 0], [0.22, 0.04], [0.18, 0.1], [0, 0.1]], chrome);
    endCap.rotation.z = -Math.PI / 2; endCap.position.set(2.74, 0, 0);
    this.wrench.add(endCap);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 28), chrome);
    collar.rotation.z = Math.PI / 2; collar.position.set(1.78, 0, 0);
    this.wrench.add(collar);

    // ---- analog torque gauge (top-left) ----------------------------------
    this.gaugeSpan = Math.PI * 1.25;
    this.gauge = new THREE.Group();
    this.gauge.position.set(-1.95, 2.12, 0.12);
    this.group.add(this.gauge);
    // turned bezel ring
    const bezel = lathe([
      [0.46, 0], [0.56, 0], [0.58, 0.05], [0.56, 0.12], [0.5, 0.14],
      [0.46, 0.12], [0.46, 0],
    ], chrome, 48);
    bezel.rotation.x = -Math.PI / 2;
    this.gauge.add(bezel);
    // dial face
    const dialFace = new THREE.Mesh(this._gaugeFaceTex(), faceMat);
    dialFace.rotation.x = -Math.PI / 2; dialFace.position.z = 0.01;
    this.gauge.add(dialFace);
    // glass cover (subtle)
    const cover = new THREE.Mesh(new THREE.CircleGeometry(0.5, 40),
      M.glass(0xdfe8ff, { transmission: 0.55, opacity: 0.25, transparent: true }));
    cover.position.z = 0.1; this.gauge.add(cover);
    // needle on a pivot
    this.needlePivot = new THREE.Group();
    this.needlePivot.position.set(0, 0, 0.06);
    this.gauge.add(this.needlePivot);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.03, 0.018),
      new THREE.MeshStandardMaterial({ color: 0xff5a5a, emissive: 0xff2a2a, emissiveIntensity: 0.4 }));
    needle.position.x = 0.16;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.018),
      new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.5 }));
    tail.position.x = -0.06;
    this.needle = needle;
    this.needlePivot.add(needle); this.needlePivot.add(tail);
    const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 18), gunLite);
    hubCap.rotation.x = Math.PI / 2; hubCap.position.z = 0.08; this.gauge.add(hubCap);

    // ---- mode button -------------------------------------------------------
    this.modeBtn = new THREE.Group();
    this.modeBtn.position.set(1.85, 2.12, 0.1);
    this.group.add(this.modeBtn);
    const btnHousing = lathe([
      [0, 0], [0.26, 0], [0.27, 0.06], [0.24, 0.1], [0.2, 0.1], [0.2, 0.02], [0, 0.02],
    ], gun, 36);
    btnHousing.rotation.x = -Math.PI / 2;
    this.modeBtn.add(btnHousing);
    this.modeLed = new THREE.MeshStandardMaterial({ color: 0x0b0d11, emissive: 0xffaa33, emissiveIntensity: 0.9, roughness: 0.4 });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.1, 28), this.modeLed);
    cap.rotation.x = Math.PI / 2; cap.position.z = 0.07;
    cap.userData.role = 'mode';
    this.modeBtn.add(cap);
    this.modeHit = cap;

    // ---- seated-bolt progress row -----------------------------------------
    this.progressRow = new THREE.Group();
    this.progressRow.position.set(-1.95, 0.22, 0.35);
    this.group.add(this.progressRow);
    this._rebuildProgress();

    // ---- debris pool (destruct snap) --------------------------------------
    this.debris = new DebrisPool(this.group, 22);

    // ---- invisible grab disc routes the rotational gesture ---------------
    const grab = new THREE.Mesh(new THREE.CircleGeometry(1.7, 32),
      new THREE.MeshBasicMaterial({ visible: false }));
    grab.position.set(0, BOLT_Y, 0.55);
    grab.userData.role = 'wrench';
    this.group.add(grab);
    this.interactive = [grab, this.modeHit];

    this.group.add(Stage.contactShadow(2.0, 0.5));
    this._setModeColor();
  }

  // A hex bolt with a chamfered head + a threaded-looking shaft. Axis along Z.
  _makeBolt(parent, mat) {
    parent.clear();
    const bolt = hexBolt(0.38, 0.32, 0.2, 1.0, mat);
    bolt.rotation.x = -Math.PI / 2;     // +Y axis -> faces +Z (head toward camera)
    parent.add(bolt);
    // thread ridges around the shaft for readable "screwing in" detail
    const threads = new THREE.Group();
    const tGeo = new THREE.TorusGeometry(0.2, 0.022, 6, 18);
    for (let i = 0; i < 9; i++) {
      const t = new THREE.Mesh(tGeo, mat);
      t.position.z = -0.34 - i * 0.085;
      threads.add(t);
    }
    parent.add(threads);
    parent.userData.head = bolt.userData.head; // the actual hex head mesh
    parent.userData.threads = threads;
  }

  // Canvas dial face with tick marks + a red redline arc.
  _gaugeFaceTex() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#0c0e13'; g.fillRect(0, 0, 256, 256);
    const cx = 128, cy = 128, R = 104;
    const a0 = Math.PI * 0.95, a1 = Math.PI * 0.05 + Math.PI * 2 * 0; // sweep CCW->CW
    const span = Math.PI * 1.25, start = Math.PI / 2 + span / 2;
    // arc track
    g.strokeStyle = '#1c2129'; g.lineWidth = 10;
    g.beginPath(); g.arc(cx, cy, R - 8, start, start - span, true); g.stroke();
    // redline
    g.strokeStyle = '#ff3b3b'; g.lineWidth = 10;
    g.beginPath(); g.arc(cx, cy, R - 8, start - span * 0.78, start - span, true); g.stroke();
    // ticks
    for (let i = 0; i <= 10; i++) {
      const a = start - span * (i / 10);
      const r0 = i % 5 === 0 ? R - 26 : R - 18;
      g.strokeStyle = i >= 8 ? '#ff7a7a' : '#cfd6e0';
      g.lineWidth = i % 5 === 0 ? 4 : 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy - Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * (R - 6), cy - Math.sin(a) * (R - 6));
      g.stroke();
    }
    g.fillStyle = '#7d8694'; g.font = '600 18px ui-sans-serif, sans-serif';
    g.textAlign = 'center'; g.fillText('N·m', cx, cy + 56);
    const tex = new THREE.CanvasTexture(cv);
    const geo = new THREE.CircleGeometry(0.46, 48);
    return new THREE.MeshBasicMaterial({ map: tex });
    // (returns material; mesh built by caller wraps it on a circle geo via faceMat — see build)
  }

  _rebuildProgress() {
    this.progressRow.clear();
    const n = Math.min(this.seated, 12);
    const seatMat = new THREE.MeshStandardMaterial({
      color: 0x101319, emissive: 0x37d98a, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.4,
    });
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.07, 6), seatMat);
      b.rotation.x = Math.PI / 2; b.position.x = i * 0.26;
      this.progressRow.add(b);
    }
  }

  _setModeColor() {
    this.modeLed.emissive.set(this.mode === 'destruct' ? 0xff3b3b : 0xffaa33);
  }

  // ---- pointer ------------------------------------------------------------
  onDown(hit, ndc) {
    if (hit?.object.userData.role === 'mode') {
      this.mode = this.mode === 'limit' ? 'destruct' : 'limit';
      this.save('ratchet.mode', this.mode);
      this._setModeColor();
      this.camKick.set(0); this.camKick.v = 0.3;
      this.ctx.feedback.emit({ type: 'switch-snap', intensity: 0.7 });
      this.refreshStat();
      return;
    }
    this.dragging = true;
    // Pivot about Z at the bolt axis (screen-projected for off-center safety).
    this.pivot = this.ctx.project(this.boltGroup.getWorldPosition(new THREE.Vector3()));
    this.lastAngle = Math.atan2(ndc.y - this.pivot.y, ndc.x - this.pivot.x);
  }

  onMove(hit, ndc) {
    if (!this.dragging) return;
    const a = Math.atan2(ndc.y - this.pivot.y, ndc.x - this.pivot.x);
    const da = wrap(a - this.lastAngle);
    this.lastAngle = a;
    if (Math.abs(da) < 1e-4) return;
    this.wrenchAngle += da;                 // handle always tracks the finger
    if (da < 0) this._tighten(-da);         // clockwise => engaged
    else this._freeSpin(da);                // ccw => free-spin rattle
  }

  onUp() { this.dragging = false; }
  onLeave() { this.dragging = false; }

  // Clockwise engaged: bolt turns with the wrench; bank rotation into clicks.
  _tighten(amount) {
    if (this.snapping || this.swapping) return;
    this.boltAngle -= amount;
    this.tightenAccum += amount;
    // More rotation per click the harder it fights back.
    const step = 0.15 + 0.6 * (this.torque / MAX);
    while (this.tightenAccum >= step) {
      this.tightenAccum -= step;
      this._pawlClick();
      if (this.torque >= MAX) {
        if (this.mode === 'limit') { this._seat(); break; }
        this.forceAccum += 1;
        if (this.forceAccum >= 3) { this._snap(); break; }
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
      pitch: 1.55 - 0.85 * tq,
    });
    // bolt visibly recoils / fights back, more violently near the redline
    this.recoil.set(0); this.recoil.v = 0.05 + 0.22 * tq;
  }

  _freeSpin(amount) {
    if (this.snapping || this.swapping) return;
    this.freeAccum += amount;
    while (this.freeAccum >= 0.14) {
      this.freeAccum -= 0.14;
      this.ctx.feedback.emit({ type: 'ratchet-tick', intensity: 0.16, pitch: 1.75 });
    }
  }

  // limit mode: seat with a clunk, cam over (slip kick), feed a fresh bolt.
  _seat() {
    this.ctx.feedback.emit({ type: 'seat', intensity: 1 });
    this.camKick.set(0); this.camKick.v = 1.0;   // cam-over slip
    this.seated++; this.save('ratchet.seated', this.seated);
    this._rebuildProgress(); this.refreshStat();
    this._swapBolt();
  }

  // destruct mode: head SNAPS off with a crack + debris, then a new bolt feeds.
  _snap() {
    this.snapping = true;
    this.ctx.feedback.emit({ type: 'snap', intensity: 1 });
    this.camKick.set(0); this.camKick.v = 1.4;
    const head = this.boltGroup.userData.head;
    if (head && !this.ctx.settings.reducedMotion) {
      const p = head.getWorldPosition(new THREE.Vector3());
      this.debris.burst(this.group.worldToLocal(p));
    }
    if (head) head.visible = false;
    this.seated++; this.save('ratchet.seated', this.seated);
    setTimeout(() => {
      if (head) head.visible = true;
      this._swapBolt();
      this.snapping = false;
    }, 360);
  }

  _swapBolt() {
    this.swapping = true;
    this.torque = 0; this.tightenAccum = 0; this.forceAccum = 0; this.freeAccum = 0;
    this.boltSlide = new Spring(170, 17, 1); this.boltSlide.set(0); // 1=above, 0=seated
    setTimeout(() => { this.swapping = false; }, 280);
  }

  // ---- per-frame ----------------------------------------------------------
  update(dt, t) {
    const kick = this.camKick.update(dt);
    const recoil = this.recoil.update(dt);

    this.wrench.rotation.z = this.wrenchAngle + kick * 0.16;

    // Threads sink into the plate as torque rises.
    let z = -this.torque * 0.16;

    if (this.boltSlide) {
      const s = this.boltSlide.update(dt);          // 1 -> 0 as it drops in
      this.boltGroup.position.y = BOLT_Y + s * 2.4;
      this.boltGroup.rotation.z = this.boltAngle + s * 7 + recoil * 0.12;
      if (this.boltSlide.atRest) { this.boltSlide = null; this.boltAngle = 0; }
    } else {
      this.boltGroup.position.y = BOLT_Y;
      this.boltGroup.rotation.z = this.boltAngle + recoil * 0.12;
    }
    this.boltGroup.position.z = z;

    // Gauge needle climbs, and quivers near the redline.
    const tq = this.torque / MAX;
    let na = this.gaugeSpan * (tq - 0.5);
    if (tq > 0.78 && !this.swapping && !this.snapping) {
      na += (Math.random() - 0.5) * 0.16 * (tq - 0.78) * 6;
    }
    this.needlePivot.rotation.z = -na;
    this.needle.material.emissiveIntensity = 0.35 + tq * 1.4;

    this.debris.update(dt);
  }

  info() {
    const m = this.mode === 'destruct' ? 'destruct' : 'limit';
    return `<span class="num">${this.seated}</span>bolts · ${m}`;
  }
}

// Small 3D debris burst for the destruct snap.
class DebrisPool {
  constructor(parent, n) {
    this.items = [];
    const geo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const mat = M.alu(0x9aa1ab);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false; m.castShadow = true; parent.add(m);
      this.items.push({ mesh: m, v: new THREE.Vector3(), life: 0, spin: new THREE.Vector3() });
    }
  }
  burst(center) {
    for (const it of this.items) {
      it.mesh.position.copy(center);
      const s = 0.6 + Math.random() * 0.8;
      it.mesh.scale.setScalar(s);
      it.v.set((Math.random() - 0.5) * 5.5, Math.random() * 5 + 1.5, (Math.random() - 0.5) * 3 + 2.5);
      it.spin.set(Math.random() * 22, Math.random() * 22, Math.random() * 22);
      it.life = 0.95; it.mesh.visible = true;
    }
  }
  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      it.v.y -= 15 * dt;
      it.mesh.position.addScaledVector(it.v, dt);
      it.mesh.rotation.x += it.spin.x * dt;
      it.mesh.rotation.y += it.spin.y * dt;
      it.mesh.rotation.z += it.spin.z * dt;
      if (it.life <= 0) it.mesh.visible = false;
    }
  }
}
