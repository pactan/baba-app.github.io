import * as THREE from 'three';
import { Station } from './base.js';
import { M, screwHead, clamp } from '../util.js';
import { Stage } from '../stage.js';

// 10 — Gears. A train of three interlocking gears facing the camera, rotating
// about Z. Each gear is built completely from scratch: a turned hub with a bore,
// a spoked web with real lightening holes, a rim ring, and N discrete trapezoidal
// teeth instanced around the circumference. The circular pitch (arc length per
// tooth) is SHARED across all wheels, so the teeth physically interlock and the
// centre distance between meshing wheels is exactly r1 + r2 (pitch radii).
//
// Mechanics: the brass driver is turned by a rotational drag measured around its
// PROJECTED centre (it sits off the station centre). The steel idler and copper
// wheel are rigidly coupled and counter-rotate at the exact tooth-count ratio so
// the teeth never separate. The train carries angular inertia and loses speed to
// bearing friction, free-wheeling after a flick. Exactly one gear-tick fires per
// driver tooth, with pitch & loudness scaling with rpm.

const TAU = Math.PI * 2;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class GearsStation extends Station {
  get title() { return 'Gears'; }
  get index() { return '10'; }
  frame() { return { y: 1.05, halfW: 2.3, halfH: 1.25 }; }

  build() {
    this.angle = 0;     // driver angle (rad)
    this.omega = 0;     // driver angular velocity (rad/s)
    this.dragging = false;
    this.vel = 0;
    this.lastTooth = 0;

    const CY = 1.05;    // train centre height
    const Z = 0.0;      // gear front plane

    this._buildBackplate(CY, Z);

    // ---- gear train --------------------------------------------------------
    // Shared circular pitch p = TAU * r / teeth  =>  pitch radius r = teeth*p/TAU.
    const p = 0.34;
    const defs = [
      { teeth: 23, mat: M.brass(),             hub: 0x9a6f24, dz: 0.00, name: 'A' }, // driver, brass
      { teeth: 13, mat: M.polishedSteel(),     hub: 0x676d76, dz: 0.16, name: 'B' }, // idler, steel (forward)
      { teeth: 30, mat: M.darkMetal(0xb56a3c), hub: 0x6e3a1f, dz: 0.00, name: 'C' }, // copper
    ];

    this.gears = [];
    let cx = -1.5;
    let prevR = 0;
    let prevTeeth = 0;
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      const r = (d.teeth * p) / TAU;
      if (i > 0) cx += prevR + r;             // centre distance = sum of pitch radii

      const mesh = this._makeGear(d.teeth, r, p, d.mat, d.hub);
      mesh.position.set(cx, CY, Z + d.dz);
      this.group.add(mesh);

      // Coupling ratio relative to the driver. Each meshing pair counter-rotates
      // with magnitude (parentTeeth/thisTeeth).
      const ratio = i === 0 ? 1 : -(prevTeeth / d.teeth) * this.gears[i - 1].ratio;

      // Phase: offset the child by half a tooth pitch so a tooth sits in the
      // parent's valley along the line of centres (the X axis here).
      const phase = i === 0 ? 0 : Math.PI / d.teeth;

      this.gears.push({ mesh, teeth: d.teeth, r, ratio, phase, x: cx, dz: d.dz });
      this._bearing(cx, CY, Z + d.dz, r);

      prevR = r; prevTeeth = d.teeth;
    }

    // ---- invisible rotational grab disc over the driver --------------------
    const g0 = this.gears[0];
    const grab = new THREE.Mesh(
      new THREE.CircleGeometry(g0.r + 0.28, 48),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    grab.position.set(g0.x, CY, Z + 0.5);
    grab.userData.role = 'driver';
    this.group.add(grab);
    this.interactive = [grab];

    this.driverX = g0.x;
    this.cy = CY;

    this.group.add(Stage.contactShadow(2.6, 0.4));
  }

  // ---- back plate, raised border, corner bolts, bearing posts --------------
  _buildBackplate(CY, Z) {
    const plateMat = M.darkMetal(0x22252b);
    plateMat.roughness = 0.58;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(4.8, 2.5, 0.2), plateMat);
    plate.position.set(0, CY, Z - 0.46);
    plate.castShadow = plate.receiveShadow = true;
    this.group.add(plate);

    const border = new THREE.Mesh(new THREE.BoxGeometry(4.56, 2.3, 0.1), M.darkMetal(0x2d313a));
    border.position.set(0, CY, Z - 0.34);
    border.receiveShadow = true;
    this.group.add(border);

    // engraved inner recess so the plate reads layered
    const recess = new THREE.Mesh(new THREE.BoxGeometry(4.3, 2.06, 0.04), M.darkMetal(0x1c1f24));
    recess.position.set(0, CY, Z - 0.3);
    recess.receiveShadow = true;
    this.group.add(recess);

    this.boltMat = M.polishedSteel();
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const b = screwHead(0.11, this.boltMat);
      b.position.set(sx * 2.12, CY + sy * 1.0, Z - 0.27);
      b.rotation.z = Math.random() * Math.PI;
      this.group.add(b);
    }
  }

  // Bearing post + cap visible through each gear's lightening holes.
  _bearing(cx, cy, z, r) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.17, r * 0.19, 0.6, 28), M.alu(0x969ca6));
    post.rotation.x = Math.PI / 2;
    post.position.set(cx, cy, z - 0.26);
    post.castShadow = post.receiveShadow = true;
    this.group.add(post);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.13, r * 0.15, 0.07, 24), this.boltMat);
    cap.rotation.x = Math.PI / 2;
    cap.position.set(cx, cy, z + 0.2);
    this.group.add(cap);

    const slot = screwHead(r * 0.1, this.boltMat);
    slot.position.set(cx, cy, z + 0.245);
    this.group.add(slot);
  }

  // Build a single gear group (local +Z toward the camera). Rotates about Z.
  _makeGear(teeth, r, pitch, mat, hubColor) {
    const g = new THREE.Group();
    const thick = 0.32;
    const rimOuter = r * 0.94;          // root circle of the teeth
    const rimInner = r * 0.70;          // inside the rim ring
    const webR = r * 0.40;              // outer radius of the spoked web region

    // ---- rim ring (outer wall, inner wall, two annular faces) --------------
    const seg = Math.max(48, teeth * 4);
    const rimOut = new THREE.Mesh(new THREE.CylinderGeometry(rimOuter, rimOuter, thick, seg, 1, true), mat);
    rimOut.rotation.x = Math.PI / 2; rimOut.castShadow = rimOut.receiveShadow = true; g.add(rimOut);
    const rimIn = new THREE.Mesh(new THREE.CylinderGeometry(rimInner, rimInner, thick, seg, 1, true), mat);
    rimIn.rotation.x = Math.PI / 2; g.add(rimIn);
    const ringFace = new THREE.RingGeometry(rimInner, rimOuter, seg);
    for (const sz of [1, -1]) {
      const f = new THREE.Mesh(ringFace, mat);
      f.position.z = sz * thick / 2;
      if (sz < 0) f.rotation.y = Math.PI;
      g.add(f);
    }

    // ---- machined hub ------------------------------------------------------
    const hubMat = M.alu(hubColor);
    hubMat.roughness = 0.32;
    const hubR = r * 0.22;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, thick + 0.08, 32), hubMat);
    hub.rotation.x = Math.PI / 2; hub.castShadow = true; g.add(hub);
    for (const sz of [1, -1]) {
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(hubR * 1.4, hubR * 1.2, 0.07, 32), hubMat);
      collar.rotation.x = Math.PI / 2; collar.position.z = sz * (thick / 2 + 0.02); g.add(collar);
    }
    // bore (dark inner tube + back disc so you never see through to nothing)
    const bore = new THREE.Mesh(new THREE.CylinderGeometry(hubR * 0.52, hubR * 0.52, thick + 0.14, 24, 1, true),
      M.darkMetal(0x14161a));
    bore.rotation.x = Math.PI / 2; g.add(bore);

    // ---- web with lightening holes ----------------------------------------
    // A thin disc spanning hub->rim, with circular holes punched as dark insets.
    const web = new THREE.Mesh(new THREE.CylinderGeometry(rimInner + 0.005, rimInner + 0.005, thick * 0.42, seg), hubMat);
    web.rotation.x = Math.PI / 2; web.castShadow = true; g.add(web);

    const nHoles = teeth >= 26 ? 7 : (teeth >= 18 ? 6 : 4);
    const holeR = (rimInner - hubR) * 0.34;
    const holeRing = (hubR + rimInner) / 2;
    const holeGeo = new THREE.CylinderGeometry(holeR, holeR, thick * 0.5, 22);
    const holeMat = M.darkMetal(0x16181d);
    for (let h = 0; h < nHoles; h++) {
      const a = (h / nHoles) * TAU + Math.PI / nHoles;
      const hole = new THREE.Mesh(holeGeo, holeMat);
      hole.rotation.x = Math.PI / 2;
      hole.position.set(Math.cos(a) * holeRing, Math.sin(a) * holeRing, 0);
      g.add(hole);
      // bright rim around each hole for a machined-edge read
      const lip = new THREE.Mesh(new THREE.TorusGeometry(holeR + 0.01, 0.012, 8, 22), hubMat);
      lip.position.set(Math.cos(a) * holeRing, Math.sin(a) * holeRing, thick * 0.21);
      g.add(lip);
      const lip2 = lip.clone(); lip2.position.z = -thick * 0.21; g.add(lip2);
    }

    // ---- teeth: trapezoidal, instanced from one extruded shape -------------
    const toothW = pitch * 0.50;        // tooth thickness at the pitch line
    const tipW = toothW * 0.56;         // narrower tip
    const rootW = toothW * 1.18;        // wider root
    const adden = pitch * 0.60;         // tip rises this far above the pitch radius
    const rootR = rimOuter;
    const pitchR = r;
    const tipR = r + adden * 0.55;

    const shape = new THREE.Shape();
    shape.moveTo(-rootW / 2, rootR);
    shape.lineTo(-toothW / 2, pitchR);
    shape.lineTo(-tipW / 2, tipR);
    shape.lineTo(tipW / 2, tipR);
    shape.lineTo(toothW / 2, pitchR);
    shape.lineTo(rootW / 2, rootR);
    shape.closePath();
    const toothGeo = new THREE.ExtrudeGeometry(shape, {
      depth: thick, bevelEnabled: true, bevelThickness: 0.016, bevelSize: 0.016, bevelSegments: 1, steps: 1,
    });
    toothGeo.translate(0, 0, -thick / 2);
    toothGeo.computeVertexNormals();

    for (let t = 0; t < teeth; t++) {
      const tooth = new THREE.Mesh(toothGeo, mat);
      tooth.rotation.z = (t / teeth) * TAU;   // shape points +Y, rotate about Z
      tooth.castShadow = true;
      g.add(tooth);
    }

    return g;
  }

  // --- rotational gesture around the driver's projected centre --------------
  _angleAt(ndc) {
    const p = this.pivotNdc || { x: 0, y: 0 };
    return Math.atan2(ndc.y - p.y, ndc.x - p.x);
  }

  onDown(hit, ndc) {
    this.dragging = true;
    this.pivotNdc = this.ctx.project(this.gears[0].mesh.getWorldPosition(new THREE.Vector3()));
    this.lastAngle = this._angleAt(ndc);
    this.lastT = performance.now() / 1000;
    this.vel = 0;
  }

  onMove(hit, ndc) {
    if (!this.dragging) return;
    const a = this._angleAt(ndc);
    const now = performance.now() / 1000;
    const dt = Math.max(1 / 240, now - this.lastT);
    const da = wrap(a - this.lastAngle);
    this.angle += da;
    this.vel = 0.55 * this.vel + 0.45 * (da / dt);  // smoothed for the flick
    this.lastAngle = a; this.lastT = now;
  }

  onUp() {
    if (this.dragging) this.omega = clamp(this.vel, -48, 48);
    this.dragging = false;
  }

  onLeave() { this.dragging = false; }

  update(dt) {
    if (this.ctx.settings.reducedMotion && !this.dragging) {
      this.omega *= Math.pow(0.0001, dt);   // settle fast
    }
    if (!this.dragging) {
      // bearing friction: a constant stiction term + speed-proportional drag
      const sign = Math.sign(this.omega);
      const fr = (0.5 + 0.11 * Math.abs(this.omega)) * dt;
      if (Math.abs(this.omega) <= fr) this.omega = 0; else this.omega -= sign * fr;
      this.angle += this.omega * dt;
    }

    for (const g of this.gears) g.mesh.rotation.z = this.angle * g.ratio + g.phase;

    // One discrete tick per driver tooth.
    const toothAngle = TAU / this.gears[0].teeth;
    const tooth = Math.floor(this.angle / toothAngle);
    if (tooth !== this.lastTooth) {
      const sp = Math.min(1, Math.abs(this.omega) / 14);
      if (Math.abs(this.omega) > 0.25 || this.dragging) {
        this.ctx.feedback.emit({
          type: 'gear-tick',
          intensity: 0.2 + 0.62 * sp,
          pitch: 0.92 + 0.5 * sp,
          pan: clamp(this.driverX / 3, -1, 1),
        });
      }
      this.lastTooth = tooth;
    }
  }

  info() {
    const rpm = Math.round(Math.abs(this.omega) / TAU * 60);
    return rpm > 4 ? `<span class="num">${rpm}</span>rpm` : 'spin a gear';
  }
}
