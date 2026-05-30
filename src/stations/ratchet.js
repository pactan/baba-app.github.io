import * as THREE from 'three';
import { Station } from './base.js';
import { Spring } from '../spring.js';
import { Stage } from '../stage.js';
import { M, rbox, lathe, hexBolt, screwHead, knurled, clamp } from '../util.js';

// 07 — Ratchet (THE HERO). A machined socket wrench tightening a hex bolt.
//
//   Clockwise drag  = ENGAGED: the hex socket grips the bolt head, the bolt turns
//     WITH the wrench, torque builds, and each pawl click ADVANCES the bolt one
//     notch. Clicks thicken from a light high 'ratchet-tick' to a heavy low
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
const GAUGE_SPAN = Math.PI * 1.25;

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
    this.dirHint = 0;          // last drag direction for the pawl visual

    // Springs: a cam-over slip kick + a quiver/recoil for the bolt fighting back.
    this.camKick = new Spring(240, 14, 0);
    this.recoil = new Spring(320, 18, 0);
    this.pawlSpring = new Spring(420, 22, 0); // little pawl tick wobble

    // ---- materials ---------------------------------------------------------
    const chrome = M.polishedSteel();
    const gun = M.darkMetal(0x2b2f36);
    const gunLite = M.darkMetal(0x3a3f48);
    this.boltMat = M.alu(0x9aa1ab);
    const plateMat = M.darkMetal(0x23262c); plateMat.roughness = 0.6;
    const faceMat = new THREE.MeshStandardMaterial({ color: 0x0c0e13, roughness: 0.55, metalness: 0.2 });
    const blackPlastic = M.plastic(0x14161b, { clearcoat: 0.3, roughness: 0.5 });

    // ---- work-plate the bolt threads into --------------------------------
    const plateGrp = new THREE.Group();
    plateGrp.position.set(0, BOLT_Y, PLATE_Z - 0.25);
    this.group.add(plateGrp);
    const plate = new THREE.Mesh(rbox(3.4, 2.15, 0.5, 0.1), plateMat);
    plate.receiveShadow = plate.castShadow = true;
    plateGrp.add(plate);
    // beveled top lip for a machined look (offset to avoid coplanar z-fight)
    const lip = new THREE.Mesh(rbox(3.46, 2.21, 0.12, 0.06), M.darkMetal(0x2e323a));
    lip.position.set(0, 0, 0.21);
    plateGrp.add(lip);
    // recessed milled pocket around the bolt
    const pocket = lathe([
      [0, 0], [0.62, 0], [0.62, -0.06], [0.5, -0.08], [0, -0.08],
    ], M.darkMetal(0x1c1f25));
    pocket.rotation.x = -Math.PI / 2;
    pocket.position.set(0, 0, 0.26);
    plateGrp.add(pocket);
    // counterbore boss the bolt seats against
    const boss = lathe([
      [0, 0], [0.5, 0], [0.5, 0.1], [0.46, 0.14], [0.3, 0.14], [0.3, 0.04], [0, 0.04],
    ], M.darkMetal(0x2e323a));
    boss.rotation.x = -Math.PI / 2;
    boss.position.set(0, 0, 0.26);
    plateGrp.add(boss);
    // four corner fasteners on the plate
    for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const s = screwHead(0.1, M.darkMetal(0x4a4f58));
      s.position.set(sx * 1.46, sy * 0.88, 0.26);
      plateGrp.add(s);
    }
    // engraved spec strip
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.26), this._stripTex());
    strip.position.set(0, -0.82, 0.262);
    plateGrp.add(strip);

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
    this._buildWrench(chrome, gun, gunLite, blackPlastic);

    // ---- analog torque gauge (top-left) ----------------------------------
    this._buildGauge(chrome, gun, gunLite, faceMat);

    // ---- mode button -------------------------------------------------------
    this._buildModeButton(chrome, gun, gunLite);

    // ---- seated-bolt progress row -----------------------------------------
    this.progressRow = new THREE.Group();
    this.progressRow.position.set(-2.05, 0.2, 0.35);
    this.group.add(this.progressRow);
    this._rebuildProgress();

    // ---- debris pool (destruct snap) --------------------------------------
    this.debris = new DebrisPool(this.group, 24);

    // ---- invisible grab disc routes the rotational gesture ---------------
    const grab = new THREE.Mesh(new THREE.CircleGeometry(1.9, 32),
      new THREE.MeshBasicMaterial({ visible: false }));
    grab.position.set(0, BOLT_Y, 0.6);
    grab.userData.role = 'wrench';
    this.group.add(grab);
    this.interactive = [grab, this.modeHit];

    this.group.add(Stage.contactShadow(2.1, 0.5));
    this._setModeColor();
  }

  // ---- wrench assembly ----------------------------------------------------
  _buildWrench(chrome, gun, gunLite, blackPlastic) {
    // Round ratchet head: a turned disc with a beveled rim + back plate.
    const headProfile = [
      [0, 0], [0.5, 0], [0.56, 0.02], [0.58, 0.06], [0.58, 0.2], [0.56, 0.26],
      [0.5, 0.28], [0.2, 0.28], [0.2, 0.06], [0, 0.06],
    ];
    const ratHead = lathe(headProfile, chrome, 64);
    ratHead.rotation.x = -Math.PI / 2;          // disc faces +Z, thin in Z
    this.wrench.add(ratHead);
    // back cap of the head
    const headBack = lathe([[0, 0], [0.56, 0], [0.58, 0.04], [0.56, 0.08], [0, 0.08]], gun, 56);
    headBack.rotation.x = Math.PI / 2;
    headBack.position.z = -0.02;
    this.wrench.add(headBack);

    // Round reversing-lever ratchet selector (a small knurled disc on the face).
    const selBase = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.05, 24), gunLite);
    selBase.rotation.x = Math.PI / 2; selBase.position.set(0, -0.34, 0.28);
    this.wrench.add(selBase);
    this.selLever = new THREE.Mesh(rbox(0.07, 0.2, 0.05, 0.025), knurled(M.darkMetal(0x44494f), 4, 0.005));
    this.selLever.position.set(0, -0.34, 0.31);
    this.selLever.rotation.z = -0.5;
    this.wrench.add(this.selLever);

    // Hex socket sleeve that visibly fits over the hex bolt head.
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.4, 6), gun);
    socket.rotation.x = Math.PI / 2; socket.position.z = -0.02; socket.castShadow = true;
    this.wrench.add(socket);
    // chamfered socket mouth (drives reading of a real 6-point socket)
    const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.4, 0.08, 6), chrome);
    mouth.rotation.x = Math.PI / 2; mouth.position.z = 0.16;
    this.wrench.add(mouth);
    // socket inner bore (slightly recessed dark hex so you read it as hollow)
    const bore = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.24, 6),
      new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.85, metalness: 0.3 }));
    bore.rotation.x = Math.PI / 2; bore.position.z = 0.1;
    this.wrench.add(bore);

    // Tapered neck from head to handle.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.27, 0.72, 24), chrome);
    neck.rotation.z = Math.PI / 2; neck.position.set(0.56, 0, 0); neck.castShadow = true;
    this.wrench.add(neck);

    // Handle: a flattened oval bar with a top reinforcing rib + a stamped panel.
    const handle = new THREE.Mesh(rbox(1.6, 0.22, 0.34, 0.1), chrome);
    handle.position.set(1.6, 0, 0); handle.castShadow = true;
    this.wrench.add(handle);
    const rib = new THREE.Mesh(rbox(1.34, 0.06, 0.16, 0.03), gunLite);
    rib.position.set(1.55, 0.13, 0);
    this.wrench.add(rib);
    const ribB = new THREE.Mesh(rbox(1.34, 0.06, 0.16, 0.03), gunLite);
    ribB.position.set(1.55, -0.13, 0);
    this.wrench.add(ribB);

    // Knurled rubber-over-steel grip with end cap + collar.
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.07, 28), chrome);
    collar.rotation.z = Math.PI / 2; collar.position.set(1.82, 0, 0); collar.castShadow = true;
    this.wrench.add(collar);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.2, 0.96, 32),
      knurled(M.darkMetal(0x26292f), 12, 0.007));
    grip.rotation.z = Math.PI / 2; grip.position.set(2.32, 0, 0); grip.castShadow = true;
    this.wrench.add(grip);
    // two soft-touch index bands on the grip
    for (const gx of [2.06, 2.58]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.212, 0.212, 0.05, 32), M.rubber(0xc23a3f));
      band.rotation.z = Math.PI / 2; band.position.set(gx, 0, 0);
      this.wrench.add(band);
    }
    const endCap = lathe([[0, 0], [0.21, 0], [0.23, 0.05], [0.19, 0.12], [0, 0.12]], chrome);
    endCap.rotation.z = -Math.PI / 2; endCap.position.set(2.84, 0, 0);
    this.wrench.add(endCap);
    // lanyard hole detail
    const lan = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.02, 10, 18), gunLite);
    lan.position.set(2.86, 0, 0); lan.rotation.y = Math.PI / 2;
    this.wrench.add(lan);
  }

  // ---- gauge --------------------------------------------------------------
  _buildGauge(chrome, gun, gunLite, faceMat) {
    this.gauge = new THREE.Group();
    this.gauge.position.set(-2.0, 2.18, 0.12);
    this.group.add(this.gauge);
    // turned bezel ring (a stepped chrome ring)
    const bezel = lathe([
      [0.42, 0], [0.56, 0], [0.6, 0.04], [0.6, 0.16], [0.56, 0.2], [0.5, 0.22],
      [0.46, 0.2], [0.46, 0.05], [0.42, 0.04], [0.42, 0],
    ], chrome, 56);
    bezel.rotation.x = -Math.PI / 2;
    this.gauge.add(bezel);
    // dark housing behind
    const housing = lathe([[0, 0], [0.46, 0], [0.46, -0.14], [0.2, -0.18], [0, -0.18]], gun, 48);
    housing.rotation.x = -Math.PI / 2;
    housing.position.z = -0.02;
    this.gauge.add(housing);
    // dial face
    const dialFace = new THREE.Mesh(new THREE.CircleGeometry(0.46, 56), this._gaugeFaceMat(faceMat));
    dialFace.position.z = 0.06;
    this.gauge.add(dialFace);
    // glass cover (subtle)
    const cover = new THREE.Mesh(new THREE.CircleGeometry(0.5, 48),
      M.glass(0xdfe8ff, { transmission: 0.55, opacity: 0.22, transparent: true }));
    cover.position.z = 0.17; this.gauge.add(cover);
    // needle on a pivot
    this.needlePivot = new THREE.Group();
    this.needlePivot.position.set(0, 0, 0.1);
    this.gauge.add(this.needlePivot);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.028, 0.016),
      new THREE.MeshStandardMaterial({ color: 0xff5a5a, emissive: 0xff2a2a, emissiveIntensity: 0.4 }));
    needle.position.x = 0.15;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.016),
      new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.5 }));
    tail.position.x = -0.065;
    this.needle = needle;
    this.needlePivot.add(needle); this.needlePivot.add(tail);
    const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 18), gunLite);
    hubCap.rotation.x = Math.PI / 2; hubCap.position.z = 0.13; this.gauge.add(hubCap);
  }

  // ---- mode button --------------------------------------------------------
  _buildModeButton(chrome, gun, gunLite) {
    this.modeBtn = new THREE.Group();
    this.modeBtn.position.set(1.9, 2.18, 0.1);
    this.group.add(this.modeBtn);
    const btnHousing = lathe([
      [0, 0], [0.28, 0], [0.29, 0.06], [0.26, 0.11], [0.21, 0.11], [0.21, 0.02], [0, 0.02],
    ], gun, 40);
    btnHousing.rotation.x = -Math.PI / 2;
    this.modeBtn.add(btnHousing);
    const ring = lathe([[0.26, 0], [0.29, 0], [0.29, 0.07], [0.26, 0.07]], chrome, 40);
    ring.rotation.x = -Math.PI / 2;
    this.modeBtn.add(ring);
    this.modeLed = new THREE.MeshStandardMaterial({ color: 0x0b0d11, emissive: 0xffaa33, emissiveIntensity: 0.9, roughness: 0.4 });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.11, 32), this.modeLed);
    cap.rotation.x = Math.PI / 2; cap.position.z = 0.08;
    cap.userData.role = 'mode';
    this.modeBtn.add(cap);
    this.modeBtnCap = cap;
    this.modeHit = cap;
  }

  // A hex bolt with a chamfered head + a threaded-looking shaft. Axis along Z.
  _makeBolt(parent, mat) {
    parent.clear();
    const bolt = hexBolt(0.4, 0.34, 0.21, 1.05, mat);
    bolt.rotation.x = -Math.PI / 2;     // +Y axis -> faces +Z (head toward camera)
    parent.add(bolt);
    // a recessed top so the socket reads as fitting over it
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 6),
      M.darkMetal(0x6c727b));
    top.rotation.x = -Math.PI / 2; top.position.z = 0.18;
    parent.add(top);
    // thread ridges around the shaft for readable "screwing in" detail
    const threads = new THREE.Group();
    const tGeo = new THREE.TorusGeometry(0.21, 0.024, 6, 20);
    for (let i = 0; i < 10; i++) {
      const t = new THREE.Mesh(tGeo, mat);
      t.position.z = -0.36 - i * 0.085;
      threads.add(t);
    }
    parent.add(threads);
    parent.userData.head = bolt.userData.head; // the actual hex head mesh
    parent.userData.top = top;
    parent.userData.threads = threads;
  }

  // engraved spec strip on the plate
  _stripTex() {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 56;
    const g = cv.getContext('2d');
    g.fillStyle = '#1a1d22'; g.fillRect(0, 0, 256, 56);
    g.fillStyle = '#6b7280'; g.font = '600 26px ui-monospace, monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('M12 · 110 N·m', 128, 30);
    const tex = new THREE.CanvasTexture(cv);
    return new THREE.MeshBasicMaterial({ map: tex });
  }

  // Canvas dial face with tick marks + a red redline arc. Returns a material.
  _gaugeFaceMat(faceMat) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#0c0e13'; g.fillRect(0, 0, 256, 256);
    // faint radial vignette for a real dial
    const vg = g.createRadialGradient(128, 128, 20, 128, 128, 128);
    vg.addColorStop(0, '#13161d'); vg.addColorStop(1, '#070a0e');
    g.fillStyle = vg; g.fillRect(0, 0, 256, 256);
    const cx = 128, cy = 128, R = 104;
    const span = GAUGE_SPAN, start = Math.PI / 2 + span / 2;
    // arc track
    g.strokeStyle = '#1c2129'; g.lineWidth = 10;
    g.beginPath(); g.arc(cx, cy, R - 8, start, start - span, true); g.stroke();
    // redline
    g.strokeStyle = '#ff3b3b'; g.lineWidth = 10;
    g.beginPath(); g.arc(cx, cy, R - 8, start - span * 0.78, start - span, true); g.stroke();
    // ticks + numbers
    for (let i = 0; i <= 10; i++) {
      const a = start - span * (i / 10);
      const major = i % 5 === 0;
      const r0 = major ? R - 28 : R - 18;
      g.strokeStyle = i >= 8 ? '#ff7a7a' : '#cfd6e0';
      g.lineWidth = major ? 4 : 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy - Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * (R - 6), cy - Math.sin(a) * (R - 6));
      g.stroke();
      if (major) {
        g.fillStyle = '#9aa3b0'; g.font = '600 16px ui-sans-serif, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(i * 11), cx + Math.cos(a) * (R - 42), cy - Math.sin(a) * (R - 42));
      }
    }
    g.fillStyle = '#7d8694'; g.font = '600 18px ui-sans-serif, sans-serif';
    g.textAlign = 'center'; g.fillText('N·m', cx, cy + 58);
    g.fillStyle = '#4a525e'; g.font = '500 12px ui-sans-serif, sans-serif';
    g.fillText('TORQUE', cx, cy + 74);
    const tex = new THREE.CanvasTexture(cv);
    return new THREE.MeshBasicMaterial({ map: tex });
  }

  _rebuildProgress() {
    this.progressRow.clear();
    const n = Math.min(this.seated, 14);
    const seatMat = new THREE.MeshStandardMaterial({
      color: 0x101319, emissive: 0x37d98a, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.4,
    });
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.07, 6), seatMat);
      b.rotation.x = Math.PI / 2; b.position.x = i * 0.24;
      this.progressRow.add(b);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 8, 6),
        M.darkMetal(0x3a3f48));
      ring.position.set(i * 0.24, 0, 0.02);
      this.progressRow.add(ring);
    }
  }

  _setModeColor() {
    const destruct = this.mode === 'destruct';
    this.modeLed.emissive.set(destruct ? 0xff3b3b : 0xffaa33);
    if (this.selLever) this.selLever.rotation.z = destruct ? 0.5 : -0.5;
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
    this.dirHint = da < 0 ? -1 : 1;
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
    this.pawlSpring.set(0); this.pawlSpring.v = 0.5 + 0.5 * tq;
  }

  _freeSpin(amount) {
    if (this.snapping || this.swapping) return;
    this.freeAccum += amount;
    while (this.freeAccum >= 0.14) {
      this.freeAccum -= 0.14;
      this.ctx.feedback.emit({ type: 'ratchet-tick', intensity: 0.16, pitch: 1.75 });
      this.pawlSpring.set(0); this.pawlSpring.v = 0.25;
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
    const top = this.boltGroup.userData.top;
    if (head && !this.ctx.settings.reducedMotion) {
      const p = head.getWorldPosition(new THREE.Vector3());
      this.debris.burst(this.group.worldToLocal(p));
    }
    if (head) head.visible = false;
    if (top) top.visible = false;
    this.seated++; this.save('ratchet.seated', this.seated);
    setTimeout(() => {
      if (head) head.visible = true;
      if (top) top.visible = true;
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
    const pawl = this.pawlSpring.update(dt);

    // The wrench follows the finger; on free-spin / cam-over it visibly slips.
    this.wrench.rotation.z = this.wrenchAngle + kick * 0.16 + (this.dirHint > 0 ? pawl * 0.02 : 0);

    // Threads sink into the plate as torque rises.
    const z = -this.torque * 0.17;

    if (this.boltSlide) {
      const s = this.boltSlide.update(dt);          // 1 -> 0 as it drops in
      this.boltGroup.position.y = BOLT_Y + s * 2.6;
      this.boltGroup.rotation.z = this.boltAngle + s * 7 + recoil * 0.12;
      if (this.boltSlide.atRest) { this.boltSlide = null; this.boltAngle = 0; }
    } else {
      this.boltGroup.position.y = BOLT_Y;
      this.boltGroup.rotation.z = this.boltAngle + recoil * 0.12;
    }
    this.boltGroup.position.z = z;

    // Gauge needle climbs, and quivers near the redline.
    const tq = this.torque / MAX;
    let na = GAUGE_SPAN * (tq - 0.5);
    if (tq > 0.78 && !this.swapping && !this.snapping) {
      na += (Math.random() - 0.5) * 0.16 * (tq - 0.78) * 6;
    }
    this.needlePivot.rotation.z = -na;
    this.needle.material.emissiveIntensity = 0.35 + tq * 1.4;

    // Mode LED breathes a touch in destruct so the danger reads.
    if (this.mode === 'destruct') {
      this.modeLed.emissiveIntensity = 0.7 + 0.4 * (0.5 + 0.5 * Math.sin(t * 6));
    } else {
      this.modeLed.emissiveIntensity += (0.9 - this.modeLed.emissiveIntensity) * Math.min(1, dt * 8);
    }

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
    const geos = [
      new THREE.BoxGeometry(0.09, 0.09, 0.09),
      new THREE.TetrahedronGeometry(0.07),
      new THREE.CylinderGeometry(0.04, 0.05, 0.1, 6),
    ];
    const mat = M.alu(0x9aa1ab);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geos[i % geos.length], mat);
      m.visible = false; m.castShadow = true; parent.add(m);
      this.items.push({ mesh: m, v: new THREE.Vector3(), life: 0, spin: new THREE.Vector3() });
    }
  }
  burst(center) {
    for (const it of this.items) {
      it.mesh.position.copy(center);
      const s = 0.6 + Math.random() * 0.9;
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
