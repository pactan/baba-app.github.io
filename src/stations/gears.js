import * as THREE from 'three';
import { Station } from './base.js';
import { Stage } from '../stage.js';

// 10 — Gears (new). A train of interlocking gears. Spin the big one with a
// flick; the others are coupled and counter-rotate at the right ratio. Each
// tooth that meshes fires a discrete tick; the train has inertia and bearing
// friction, so it free-wheels and slows like real metal.
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class GearsStation extends Station {
  get title() { return 'Gears'; }
  get index() { return '10'; }

  build() {
    this.angle = 0;
    this.omega = 0;
    this.dragging = false;
    this.lastTooth = 0;

    const mats = [
      new THREE.MeshPhysicalMaterial({ color: 0xd98b59, roughness: 0.35, metalness: 0.9 }), // brass
      new THREE.MeshPhysicalMaterial({ color: 0xcfd3da, roughness: 0.3, metalness: 1 }),     // steel
      new THREE.MeshPhysicalMaterial({ color: 0xc77b8b, roughness: 0.4, metalness: 0.8 }),   // copper-pink
    ];

    // Gear A drives B drives C. Tooth pitch is shared so they mesh.
    const pitch = 0.26; // arc length per tooth (approx)
    const defs = [
      { teeth: 16, mat: 0 },
      { teeth: 11, mat: 1 },
      { teeth: 22, mat: 2 },
    ];
    this.gears = [];
    let cx = -1.4;
    let prevR = 0;
    for (let i = 0; i < defs.length; i++) {
      const teeth = defs[i].teeth;
      const r = (teeth * pitch) / (Math.PI * 2);
      if (i > 0) cx += prevR + r; // center distance = r_prev + r_cur so teeth mesh
      const g = this._makeGear(teeth, r, mats[defs[i].mat]);
      g.position.set(cx, 1.05, 0);
      this.group.add(g);
      // Counter-rotating ratio relative to the driver (gear A).
      const ratio = i === 0 ? 1 : (defs[0].teeth / teeth) * (i % 2 === 0 ? 1 : -1);
      this.gears.push({ mesh: g, teeth, r, ratio, phase: 0 });
      prevR = r;
    }

    // Grab disc over the driver gear.
    const grab = new THREE.Mesh(new THREE.CircleGeometry(this.gears[0].r + 0.2, 32), new THREE.MeshBasicMaterial({ visible: false }));
    grab.position.set(this.gears[0].mesh.position.x, 1.05, 0.3);
    this.group.add(grab);
    this.interactive = [grab];
    this.driverX = this.gears[0].mesh.position.x;

    this.group.add(Stage.contactShadow(2.2, 0.45));
  }

  _makeGear(teeth, r, mat) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.3, Math.max(24, teeth * 2)), mat);
    body.rotation.x = Math.PI / 2; body.castShadow = true;
    g.add(body);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.25, r * 0.25, 0.36, 24),
      new THREE.MeshPhysicalMaterial({ color: 0x33363d, roughness: 0.5, metalness: 0.8 }));
    hub.rotation.x = Math.PI / 2; g.add(hub);
    const toothGeo = new THREE.BoxGeometry(0.12, 0.16, 0.3);
    for (let t = 0; t < teeth; t++) {
      const a = (t / teeth) * Math.PI * 2;
      const tooth = new THREE.Mesh(toothGeo, mat);
      tooth.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
      tooth.rotation.z = a;
      tooth.castShadow = true;
      g.add(tooth);
    }
    return g;
  }

  onDown(hit, ndc) {
    this.dragging = true;
    this.lastAngle = Math.atan2(ndc.y, ndc.x);
    this.lastT = performance.now() / 1000;
    this.vel = 0;
  }

  onMove(hit, ndc) {
    if (!this.dragging) return;
    const a = Math.atan2(ndc.y, ndc.x);
    const now = performance.now() / 1000;
    const dt = Math.max(1 / 240, now - this.lastT);
    const da = wrap(a - this.lastAngle);
    this.angle += da;
    this.vel = da / dt;
    this.lastAngle = a; this.lastT = now;
  }

  onUp() {
    if (this.dragging) this.omega = Math.max(-40, Math.min(40, this.vel));
    this.dragging = false;
  }

  update(dt) {
    if (!this.dragging) {
      const sign = Math.sign(this.omega);
      const fr = (0.5 + 0.12 * Math.abs(this.omega)) * dt; // a bit more friction than the spinner
      if (Math.abs(this.omega) <= fr) this.omega = 0; else this.omega -= sign * fr;
      this.angle += this.omega * dt;
    }

    for (const g of this.gears) g.mesh.rotation.z = this.angle * g.ratio + g.phase;

    // One tick per tooth of the driver gear.
    const toothAngle = (Math.PI * 2) / this.gears[0].teeth;
    const tooth = Math.floor(this.angle / toothAngle);
    if (tooth !== this.lastTooth) {
      const sp = Math.min(1, Math.abs(this.omega) / 12);
      if (Math.abs(this.omega) > 0.2 || this.dragging) {
        this.ctx.feedback.emit({ type: 'gear-tick', intensity: 0.25 + 0.6 * sp, pitch: 1.1 + 0.3 * sp, pan: this.driverX / 3 });
      }
      this.lastTooth = tooth;
    }
  }

  info() {
    const rpm = Math.round(Math.abs(this.omega) / (Math.PI * 2) * 60);
    return rpm > 5 ? `<span class="num">${rpm}</span>rpm` : 'spin a gear';
  }
}
