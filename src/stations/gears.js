import * as THREE from 'three';
import { Station } from './base.js';
import { M, screwHead, clamp } from '../util.js';
import { Stage } from '../stage.js';

// 10 — Gears. A train of three interlocking gears facing the camera, rotating
// about Z. Each gear is built from a machined hub + spokes + a rim + N discrete
// trapezoidal teeth. The circular pitch (arc length per tooth) is SHARED across
// all gears, so the teeth physically mesh; the center distance between two
// gears is r1 + r2 (pitch radii). Drive the big gear by a rotational drag around
// its projected center; the others are rigidly coupled and counter-rotate at the
// exact tooth-count ratio so the teeth never separate. The train carries inertia
// and loses speed to bearing friction, free-wheeling after a flick. One discrete
// gear-tick fires per tooth of the driver, its pitch & loudness scaling with rpm.

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const TAU = Math.PI * 2;

export class GearsStation extends Station {
  get title() { return 'Gears'; }
  get index() { return '10'; }
  frame() { return { y: 1.05, halfW: 2.3, halfH: 1.25 }; }

  build() {
    this.angle = 0;      // driver angle (rad)
    this.omega = 0;      // driver angular velocity (rad/s)
    this.dragging = false;
    this.lastTooth = 0;

    const CY = 1.05;     // train center height
    const Z = 0.0;       // gear plane

    // ---- back plate + frame -------------------------------------------------
    const plateMat = M.darkMetal(0x23262c);
    plateMat.roughness = 0.55;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(4.7, 2.5, 0.18), plateMat);
    plate.position.set(0, CY, Z - 0.34);
    plate.castShadow = plate.receiveShadow = true;
    this.group.add(plate);
    // beveled raised border for depth
    const border = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.32, 0.06), M.darkMetal(0x2c3038));
    border.position.set(0, CY, Z - 0.24);
    border.receiveShadow = true;
    this.group.add(border);
    // four corner bolts
    const boltMat = M.polishedSteel();
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const b = screwHead(0.1, boltMat);
      b.position.set(sx * 2.08, CY + sy * 1.0, Z - 0.2);
      b.rotation.z = Math.random() * Math.PI;
      this.group.add(b);
    }

    // ---- gear train ---------------------------------------------------------
    // Circular pitch p = TAU * r / teeth, shared => pitch radius r = teeth*p/TAU.
    const p = 0.30;
    const defs = [
      { teeth: 21, mat: M.brass(),         hub: 0x8a6320, z: 0.0 },   // A — driver (brass)
      { teeth: 12, mat: M.polishedSteel(), hub: 0x5a6068, z: 0.14 },  // B — idler  (steel)
      { teeth: 28, mat: M.darkMetal(0xb5663b), hub: 0x6e3a1f, z: 0.0 }, // C — copper
    ];
    // Stagger gear B forward in Z slightly so coplanar tooth tips never z-fight
    // its neighbours; A and C share a plane but never touch each other.

    this.gears = [];
    let cx = -1.55;
    let prevR = 0;
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      const r = (d.teeth * p) / TAU;          // pitch radius
      if (i > 0) cx += prevR + r;             // center distance = sum of pitch radii
      const mesh = this._makeGear(d.teeth, r, p, d.mat, d.hub);
      mesh.position.set(cx, CY, Z + d.z);
      this.group.add(mesh);

      // Coupling: meshing gears counter-rotate; ratio = -teethDriver/teethThis.
      // (Sign alternates down the chain; magnitude is set by tooth counts.)
      const ratio = i === 0 ? 1 : -(defs[i - 1].teeth / d.teeth) * this.gears[i - 1].ratio;
      // Phase so a tooth of this gear sits in the valley of its neighbour.
      let phase = 0;
      if (i > 0) {
        // Align the line of centers: put a tooth gap of this gear toward prev.
        phase = Math.PI / d.teeth; // half a tooth offset for meshing
      }
      this.gears.push({ mesh, teeth: d.teeth, r, ratio, phase, x: cx });

      // Bearing post + cap behind each gear (visible through the spoke holes).
      const post = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.16, 0.5, 24), M.alu(0x9aa0a8));
      post.rotation.x = Math.PI / 2; post.position.set(cx, CY, Z + d.z - 0.2);
      post.castShadow = true; this.group.add(post);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.12, r * 0.12, 0.08, 20), boltMat);
      cap.rotation.x = Math.PI / 2; cap.position.set(cx, CY, Z + d.z + 0.12);
      this.group.add(cap);
      const slot = screwHead(r * 0.1, boltMat);
      slot.position.set(cx, CY, Z + d.z + 0.17);
      this.group.add(slot);

      prevR = r;
    }

    // Compute initial mesh phases so the trains start interlocked, then refine
    // each child's phase so its tooth sits in the parent's gap along the line of
    // centers (purely cosmetic alignment; ratio keeps it locked thereafter).
    this._alignPhases();

    // ---- invisible grab disc over the driver -------------------------------
    const g0 = this.gears[0];
    const grab = new THREE.Mesh(
      new THREE.CircleGeometry(g0.r + 0.25, 40),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    grab.position.set(g0.x, CY, Z + 0.4);
    grab.userData.role = 'driver';
    this.group.add(grab);
    this.interactive = [grab];
    this.driverX = g0.x;
    this.cy = CY;

    this.group.add(Stage.contactShadow(2.4, 0.42));
  }

  // Align each gear's rotational phase so a tooth meets the neighbour's gap
  // along the line of centers (here the X axis). Both meshing wheels carry a
  // tooth pointing along +X/-X by construction (tooth 0 points +Y after the
  // shape rotation, and teeth are evenly spaced), so offsetting a child by half
  // a tooth pitch puts its tip into the parent's valley at the contact point.
  _alignPhases() {
    for (let i = 1; i < this.gears.length; i++) {
      const b = this.gears[i];
      b.phase = Math.PI / b.teeth; // half-tooth offset for clean meshing
    }
  }

  // Build a single gear: rim ring + spokes + hub + N trapezoidal teeth, all in
  // a group that rotates about Z (the group's local +Z faces the camera).
  _makeGear(teeth, r, pitch, mat, hubColor) {
    const g = new THREE.Group();
    const thick = 0.30;
    const rimInner = r * 0.62;
    const rimOuter = r * 0.96;       // tooth roots sit just outside this

    // Rim: a flat ring (Tube-like) via a CylinderGeometry shell — use a ring of
    // a thick torus-ish slab made from a Lathe-free extruded ring.
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(rimOuter, rimOuter, thick, Math.max(40, teeth * 3), 1, true),
      mat
    );
    rim.rotation.x = Math.PI / 2; rim.castShadow = rim.receiveShadow = true;
    g.add(rim);
    // inner wall of the rim (so it reads as a ring, not a disc)
    const rimIn = new THREE.Mesh(
      new THREE.CylinderGeometry(rimInner, rimInner, thick, Math.max(32, teeth * 2), 1, true),
      mat
    );
    rimIn.rotation.x = Math.PI / 2; g.add(rimIn);
    // front/back rings closing the rim slab
    const ringShape = new THREE.RingGeometry(rimInner, rimOuter, Math.max(40, teeth * 3));
    for (const sz of [1, -1]) {
      const face = new THREE.Mesh(ringShape, mat);
      face.position.z = sz * thick / 2;
      if (sz < 0) face.rotation.y = Math.PI;
      g.add(face);
    }

    // Hub: machined boss with a beveled collar.
    const hubMat = M.alu(hubColor);
    hubMat.roughness = 0.34;
    const hubR = r * 0.30;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, thick + 0.06, 28), hubMat);
    hub.rotation.x = Math.PI / 2; hub.castShadow = true; g.add(hub);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(hubR * 1.35, hubR * 1.35, 0.06, 28), hubMat);
    collar.rotation.x = Math.PI / 2; collar.position.z = thick / 2 + 0.04; g.add(collar);
    // bore
    const bore = new THREE.Mesh(new THREE.CylinderGeometry(hubR * 0.5, hubR * 0.5, thick + 0.12, 20), M.darkMetal(0x15171b));
    bore.rotation.x = Math.PI / 2; g.add(bore);

    // Spokes connecting hub to rim (with visible gaps = lightening holes).
    const nSpokes = teeth >= 24 ? 6 : (teeth >= 16 ? 5 : 4);
    const spokeLen = rimInner - hubR + 0.04;
    const spokeGeo = new THREE.BoxGeometry(r * 0.13, spokeLen, thick * 0.7);
    for (let s = 0; s < nSpokes; s++) {
      const a = (s / nSpokes) * TAU;
      const spoke = new THREE.Mesh(spokeGeo, hubMat);
      const mid = (hubR + rimInner) / 2;
      spoke.position.set(Math.cos(a) * mid, Math.sin(a) * mid, 0);
      spoke.rotation.z = a - Math.PI / 2;
      spoke.castShadow = true;
      g.add(spoke);
    }

    // Teeth: trapezoidal involute-approximation. Build ONE extruded tooth shape
    // and instance it around the circumference. Tooth dimensions derive from the
    // shared pitch so neighbouring gears interlock.
    const toothW = pitch * 0.52;       // tooth thickness at pitch line (≈ half pitch)
    const tipW = toothW * 0.55;        // narrower at tip (trapezoid)
    const rootW = toothW * 1.12;       // wider at root
    const adden = pitch * 0.62;        // tooth height above pitch radius
    const rootR = rimOuter;            // root circle
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
      depth: thick, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1, steps: 1,
    });
    toothGeo.translate(0, 0, -thick / 2);
    toothGeo.computeVertexNormals();

    for (let t = 0; t < teeth; t++) {
      const a = (t / teeth) * TAU;
      const tooth = new THREE.Mesh(toothGeo, mat);
      tooth.rotation.z = a; // shape is built pointing +Y (radius up), rotate around Z
      tooth.castShadow = true;
      g.add(tooth);
    }

    return g;
  }

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
    // smoothed velocity estimate for the flick
    this.vel = 0.6 * this.vel + 0.4 * (da / dt);
    this.lastAngle = a; this.lastT = now;
  }

  onUp() {
    if (this.dragging) this.omega = clamp(this.vel, -45, 45);
    this.dragging = false;
  }

  onLeave() { this.dragging = false; }

  update(dt) {
    if (this.ctx.settings.reducedMotion && !this.dragging) {
      this.omega *= Math.pow(0.0001, dt); // settle fast
    }
    if (!this.dragging) {
      const sign = Math.sign(this.omega);
      // bearing friction: a constant term + a speed-proportional drag
      const fr = (0.55 + 0.10 * Math.abs(this.omega)) * dt;
      if (Math.abs(this.omega) <= fr) this.omega = 0; else this.omega -= sign * fr;
      this.angle += this.omega * dt;
    }

    for (const g of this.gears) g.mesh.rotation.z = this.angle * g.ratio + g.phase;

    // One discrete tick per tooth of the driver.
    const toothAngle = TAU / this.gears[0].teeth;
    const tooth = Math.floor(this.angle / toothAngle);
    if (tooth !== this.lastTooth) {
      const sp = Math.min(1, Math.abs(this.omega) / 14);
      if (Math.abs(this.omega) > 0.25 || this.dragging) {
        this.ctx.feedback.emit({
          type: 'gear-tick',
          intensity: 0.22 + 0.62 * sp,
          pitch: 0.95 + 0.45 * sp,
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
