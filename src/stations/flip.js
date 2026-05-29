import * as THREE from 'three';
import { Station } from './base.js';
import { Spring } from '../spring.js';
import { Stage } from '../stage.js';
import { M, rbox, lathe, screwHead, clamp } from '../util.js';

// 05 — Flip. A row of 4 wall toggle switches with true snap-action. Tap = quick
// flip. DRAG the bat-handle lever and it RESISTS (tracking your finger up to
// center) then SNAPS past, the accelerating spring carrying it home with an
// overshoot. The 'switch-snap' event + the single decisive haptic fire at the
// CENTER-CROSSING — never during the resistance phase. Each LED dome toggles.
const COUNT = 4;
const PITCH = 1.02;        // x spacing between switches
const ANGLE = 0.62;        // lever tilt each way (radians from vertical)

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

    const plateMat = M.plastic(0xf3f4f6, { clearcoat: 0.7, clearcoatRoughness: 0.25 });
    const insetMat = M.plastic(0xe7e9ee, { roughness: 0.5, clearcoat: 0.4 });
    const screwMat = M.alu(0xb7bcc4);
    const leverMat = M.darkMetal(0x2b2e35);
    const tipMat = M.polishedSteel();

    const PW = COUNT * PITCH + 0.5;     // plate width
    const PH = 1.9;                     // plate height
    const PY = 0.95;                    // plate center height
    const PZ = 0.0;                     // plate sits at z=0, builds forward

    // --- faceplate: rounded slab + beveled recessed inset ---
    const plate = new THREE.Mesh(rbox(PW, PH, 0.26, 0.1), plateMat);
    plate.position.set(0, PY, PZ);
    plate.castShadow = plate.receiveShadow = true;
    this.group.add(plate);

    // beveled frame around an inset panel (the recessed area the levers live in)
    const bevel = lathe([
      [0, 0], [0.04, 0.0], [0.04, 0.02],
    ], insetMat, 4); // tiny — replaced by an explicit inset below
    bevel.visible = false; this.group.add(bevel);

    const inset = new THREE.Mesh(rbox(PW - 0.36, PH - 0.36, 0.1, 0.07), insetMat);
    inset.position.set(0, PY, PZ + 0.11);
    inset.castShadow = false; inset.receiveShadow = true;
    this.group.add(inset);
    // chamfered rim to kill the hard seam between inset & plate
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(PW - 0.30, PH - 0.30, 0.06), insetMat);
    rim.position.set(0, PY, PZ + 0.07);
    this.group.add(rim);

    // --- corner screw heads ---
    const sx = PW / 2 - 0.16, sy = PH / 2 - 0.16;
    for (const ox of [-1, 1]) for (const oy of [-1, 1]) {
      const s = screwHead(0.085, screwMat);
      s.position.set(ox * sx, PY + oy * sy, PZ + 0.135);
      s.rotation.z = (ox * oy > 0 ? 0.5 : -0.4); // varied slot angles, realistic
      this.group.add(s);
    }

    const faceZ = PZ + 0.16;            // front face of the inset
    this.switches = [];
    this.interactive = [];
    const half = (COUNT - 1) / 2;

    for (let i = 0; i < COUNT; i++) {
      const x = (i - half) * PITCH;

      // raised toggle bezel (the chrome collar the lever pokes through)
      const bezel = lathe([
        [0.0, 0.0], [0.20, 0.0], [0.21, 0.03], [0.17, 0.07],
        [0.115, 0.10], [0.10, 0.13], [0.10, 0.15],
      ], M.alu(0xc6cbd2), 40);
      bezel.position.set(x, PY + 0.42, faceZ - 0.02);
      bezel.rotation.x = Math.PI / 2;     // open toward +Z
      this.group.add(bezel);

      // pivot at the bezel mouth; lever rocks about local X
      const pivot = new THREE.Group();
      pivot.position.set(x, PY + 0.42, faceZ + 0.06);
      this.group.add(pivot);

      // bat-handle lever: turned shaft (waist) + ball tip, built up +Y
      const lever = new THREE.Group();
      const shaft = lathe([
        [0.0, 0.0], [0.075, 0.0], [0.07, 0.10], [0.052, 0.24],
        [0.05, 0.34], [0.062, 0.40], [0.06, 0.42],
      ], leverMat, 32);
      lever.add(shaft);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.105, 28, 20), leverMat);
      tip.position.y = 0.5; tip.castShadow = true;
      lever.add(tip);
      const gleam = new THREE.Mesh(new THREE.SphereGeometry(0.108, 24, 16),
        new THREE.MeshPhysicalMaterial({ color: 0x000000, metalness: 0, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.0 }));
      gleam.position.y = 0.5; lever.add(gleam);
      // small polished collar at base of the bat
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.082, 0.082, 0.05, 28), tipMat);
      collar.position.y = 0.03; lever.add(collar);
      lever.children.forEach((c) => { if (c.isMesh) c.castShadow = true; });
      pivot.add(lever);

      // invisible grab paddle covering the lever swing
      const grab = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.74, 0.5),
        new THREE.MeshBasicMaterial({ visible: false }));
      grab.position.set(0, 0.28, 0.05);
      grab.userData.idx = i;
      pivot.add(grab);
      this.interactive.push(grab);

      // indicator LED dome below the switch
      const ledMat = M.led(0x5fd0ff, 0.08);
      const lensMat = M.glass(0xbfe9ff, { transmission: 0.6, thickness: 0.4, roughness: 0.08, opacity: 0.85 });
      const ledBase = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.13, 0.05, 28), M.darkMetal(0x2a2d34));
      ledBase.position.set(x, PY - 0.5, faceZ - 0.01); ledBase.rotation.x = Math.PI / 2;
      this.group.add(ledBase);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.085, 28, 20), ledMat);
      led.position.set(x, PY - 0.5, faceZ + 0.02);
      this.group.add(led);
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.10, 24, 16), lensMat);
      lens.position.set(x, PY - 0.5, faceZ + 0.02);
      this.group.add(lens);

      // tiny engraved label ticks (ON above / OFF below) — subtle dark marks
      const tickMat = new THREE.MeshStandardMaterial({ color: 0x6a6f78, roughness: 0.6 });
      const tUp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.01), tickMat);
      tUp.position.set(x, PY + 0.74, faceZ + 0.001); this.group.add(tUp);
      const tDn = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.01), tickMat);
      tDn.position.set(x, PY + 0.06, faceZ + 0.001); this.group.add(tDn);

      const start = this.state[i] ? ANGLE : -ANGLE;
      const spring = new Spring(360, 17, start);
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
    const progress = clamp(dy * dir * 3.4, 0, 1.0 + 0.3);
    if (progress <= 0) { this.dragAngle = null; sw.spring.set(on ? ANGLE : -ANGLE); return; }

    // current resting angle -> toward 0 (center) as progress climbs to ~1.
    const from = on ? ANGLE : -ANGLE;
    const a = from * (1 - Math.min(1, progress)); // eases to 0 at center
    this.dragAngle = a;
    sw.spring.snap(a);                     // hold the lever under the finger

    // crossing center => SNAP (this is the only place the event fires)
    if (progress >= 1.0) this._snap(this.active);
  }

  onUp() {
    // A tap (no decisive drag) still flips, snapping from center.
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
      // LED brightens toward target with a little lag for a warm-up feel
      const want = (sw.spring.target > 0) ? 1.7 : 0.08;
      sw.ledMat.emissiveIntensity += (want - sw.ledMat.emissiveIntensity) * Math.min(1, dt * 8);
    }
  }

  info() {
    const on = this.state.filter(Boolean).length;
    return `<span class="num">${on}</span>/${COUNT} on`;
  }
}
