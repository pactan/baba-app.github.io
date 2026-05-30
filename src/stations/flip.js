import * as THREE from 'three';
import { Station } from './base.js';
import { Spring } from '../spring.js';
import { Stage } from '../stage.js';
import { M, rbox, lathe, screwHead, clamp } from '../util.js';

// 05 — Flip. A row of 4 wall toggle switches with true snap-action. Tap = quick
// flip. DRAG the bat-handle lever and it RESISTS (tracking your finger up to
// center) then SNAPS past, an accelerating spring carrying it home with an
// overshoot. The 'switch-snap' event + the single decisive haptic fire at the
// CENTER-CROSSING — never during the resistance phase. Each LED dome toggles.
const COUNT = 4;
const PITCH = 1.05;        // x spacing between switches
const ANGLE = 0.6;         // lever tilt each way (radians from vertical)
const PY = 0.95;           // plate center height

export class FlipStation extends Station {
  get title() { return 'Flip'; }
  get index() { return '05'; }
  frame() { return { y: 0.95, halfW: 2.3, halfH: 1.25 }; }

  build() {
    this.state = this.load('flip.state', new Array(COUNT).fill(false));
    if (!Array.isArray(this.state) || this.state.length !== COUNT) {
      this.state = new Array(COUNT).fill(false);
    }
    this.state = this.state.map(Boolean);

    const plateMat = M.plastic(0xf4f5f7, { clearcoat: 0.7, clearcoatRoughness: 0.22 });
    const insetMat = M.plastic(0xe9ebef, { roughness: 0.46, clearcoat: 0.45 });
    const trimMat = M.alu(0xc4c9d1);
    const screwMat = M.alu(0xb2b7bf);
    const leverMat = M.darkMetal(0x2a2d34);
    const collarMat = M.polishedSteel();

    const PW = COUNT * PITCH + 0.55;     // plate width
    const PH = 1.95;                     // plate height
    const FACE = 0.16;                   // front face of the plate

    // --- faceplate: rounded slab with a wide chamfered border ---
    const plate = new THREE.Mesh(rbox(PW, PH, 0.28, 0.11), plateMat);
    plate.position.set(0, PY, 0);
    plate.castShadow = plate.receiveShadow = true;
    this.group.add(plate);

    // beveled recessed inset (a slightly smaller, slightly proud panel with a
    // chamfer ring so there's no hard seam)
    const insetW = PW - 0.42, insetH = PH - 0.42;
    const cham = new THREE.Mesh(rbox(insetW + 0.08, insetH + 0.08, 0.06, 0.06), trimMat);
    cham.position.set(0, PY, FACE - 0.05);
    this.group.add(cham);
    const inset = new THREE.Mesh(rbox(insetW, insetH, 0.08, 0.05), insetMat);
    inset.position.set(0, PY, FACE - 0.04);
    inset.receiveShadow = true;
    this.group.add(inset);

    // --- corner screw heads ---
    const sx = PW / 2 - 0.17, sy = PH / 2 - 0.17;
    for (const ox of [-1, 1]) for (const oy of [-1, 1]) {
      const s = screwHead(0.085, screwMat);
      s.position.set(ox * sx, PY + oy * sy, FACE - 0.005);
      s.rotation.z = (ox * oy > 0 ? 0.5 : -0.4);
      this.group.add(s);
    }

    this.switches = [];
    this.interactive = [];
    const half = (COUNT - 1) / 2;

    for (let i = 0; i < COUNT; i++) {
      const x = (i - half) * PITCH;
      const swY = PY + 0.42;

      // raised chrome bezel the lever pokes through (turned, opening toward +Z)
      const bezel = lathe([
        [0.0, 0.0], [0.21, 0.0], [0.22, 0.025], [0.185, 0.06],
        [0.13, 0.10], [0.115, 0.14], [0.115, 0.16],
      ], trimMat, 44);
      bezel.position.set(x, swY, FACE - 0.02);
      bezel.rotation.x = Math.PI / 2;
      this.group.add(bezel);

      // pivot at the bezel mouth; the lever rocks about local X
      const pivot = new THREE.Group();
      pivot.position.set(x, swY, FACE + 0.07);
      this.group.add(pivot);

      // bat-handle lever: waisted shaft + ball tip + polished base collar
      const lever = new THREE.Group();
      const shaft = lathe([
        [0.0, 0.0], [0.082, 0.0], [0.075, 0.10], [0.052, 0.26],
        [0.05, 0.36], [0.064, 0.43], [0.062, 0.45],
      ], leverMat, 36);
      lever.add(shaft);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.115, 30, 22), leverMat);
      tip.position.y = 0.52;
      lever.add(tip);
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.088, 0.088, 0.05, 30), collarMat);
      collar.position.y = 0.03;
      lever.add(collar);
      lever.children.forEach((c) => { if (c.isMesh) c.castShadow = true; });
      pivot.add(lever);

      // invisible grab paddle covering the swing
      const grab = new THREE.Mesh(
        new THREE.BoxGeometry(0.46, 0.8, 0.55),
        new THREE.MeshBasicMaterial({ visible: false }));
      grab.position.set(0, 0.3, 0.06);
      grab.userData.idx = i;
      pivot.add(grab);
      this.interactive.push(grab);

      // engraved ON / OFF tick marks above & below
      const tickMat = new THREE.MeshStandardMaterial({ color: 0x71767f, roughness: 0.6 });
      const tUp = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.022, 0.012), tickMat);
      tUp.position.set(x, PY + 0.78, FACE - 0.035); this.group.add(tUp);
      const tDn = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.022, 0.012), tickMat);
      tDn.position.set(x, PY + 0.04, FACE - 0.035); this.group.add(tDn);

      // indicator LED dome below the switch (glassy lens over an emissive core)
      const ledMat = M.led(0x5fd0ff, 0.08);
      const lensMat = M.glass(0xc6ecff, { transmission: 0.55, thickness: 0.4, roughness: 0.06, opacity: 0.85 });
      const ledRing = lathe([
        [0.0, 0.0], [0.13, 0.0], [0.13, 0.03], [0.10, 0.045], [0.10, 0.05],
      ], M.darkMetal(0x2a2d34), 30);
      ledRing.position.set(x, PY - 0.52, FACE - 0.05);
      ledRing.rotation.x = -Math.PI / 2;
      this.group.add(ledRing);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.082, 28, 20), ledMat);
      led.position.set(x, PY - 0.52, FACE - 0.01);
      this.group.add(led);
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.1, 26, 18), lensMat);
      lens.position.set(x, PY - 0.52, FACE - 0.01);
      this.group.add(lens);

      const start = this.state[i] ? ANGLE : -ANGLE;
      const spring = new Spring(360, 16, start);
      lever.rotation.x = -start;
      ledMat.emissiveIntensity = this.state[i] ? 1.7 : 0.08;
      this.switches.push({ pivot, lever, spring, ledMat, x, dragging: false });
    }

    this.group.add(Stage.contactShadow(PW * 0.5 + 0.2, 0.45));

    this.active = -1;
    this.startNdc = null;
    this.snapped = false;
    this.dragAngle = null;
  }

  onDown(hit, ndc) {
    this.active = hit?.object.userData.idx ?? -1;
    this.startNdc = ndc.clone();
    this.snapped = false;
    this.dragAngle = null;
    if (this.active >= 0) this.switches[this.active].dragging = true;
  }

  onMove(hit, ndc) {
    if (this.active < 0 || this.snapped) return;
    const sw = this.switches[this.active];
    const dy = ndc.y - this.startNdc.y;
    const on = this.state[this.active];

    // Map vertical drag to a lever angle, but only while fighting toward center.
    // The lever tracks the finger through the resistance phase (no events).
    const dir = on ? -1 : 1;               // direction that flips it
    const progress = clamp(dy * dir * 3.2, 0, 1.3);
    if (progress <= 0) { this.dragAngle = null; sw.spring.set(on ? ANGLE : -ANGLE); return; }

    // ease the resting angle toward 0 (center) as progress approaches 1
    const from = on ? ANGLE : -ANGLE;
    const a = from * (1 - Math.min(1, progress));
    this.dragAngle = a;
    sw.spring.snap(a);                     // hold the lever under the finger

    if (progress >= 1.0) this._snap(this.active);   // crossing center => SNAP
  }

  onUp() {
    // A tap (no decisive drag) still flips, snapping from wherever it is.
    if (this.active >= 0 && !this.snapped) this._snap(this.active);
    if (this.active >= 0) this.switches[this.active].dragging = false;
    this.active = -1;
    this.dragAngle = null;
  }

  onLeave() {
    if (this.active >= 0) this.switches[this.active].dragging = false;
    this.active = -1;
    this.dragAngle = null;
  }

  _snap(i) {
    this.snapped = true;
    const sw = this.switches[i];
    sw.dragging = false;
    this.state[i] = !this.state[i];
    this.save('flip.state', this.state);
    const target = this.state[i] ? ANGLE : -ANGLE;
    sw.spring.set(target);
    // velocity kick = accelerating snap-through + overshoot
    sw.spring.v += (this.state[i] ? 1 : -1) * (this.ctx.settings.reducedMotion ? 0 : 9);
    if (this.ctx.settings.reducedMotion) sw.spring.snap(target);
    sw.ledMat.emissiveIntensity = this.state[i] ? 1.7 : 0.08;
    // ONE decisive haptic, exactly at the center-crossing.
    this.ctx.feedback.emit({
      type: 'switch-snap',
      intensity: 0.95,
      pitch: this.state[i] ? 1.06 : 0.9,
      pan: clamp(sw.x / 2.2, -1, 1),
    });
    this.refreshStat();
  }

  update(dt) {
    for (const sw of this.switches) {
      const a = sw.dragging && this.dragAngle != null ? this.dragAngle
        : sw.spring.update(dt);
      sw.lever.rotation.x = -a;
      const want = (sw.spring.target > 0) ? 1.7 : 0.08;
      sw.ledMat.emissiveIntensity += (want - sw.ledMat.emissiveIntensity) * Math.min(1, dt * 8);
    }
  }

  info() {
    const on = this.state.filter(Boolean).length;
    return `<span class="num">${on}</span>/${COUNT} on`;
  }
}
