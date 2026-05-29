import * as THREE from 'three';
import { Station } from './base.js';
import { Spring } from '../spring.js';
import { Stage } from '../stage.js';

// 05 — Flip. A row of wall-style toggle switches with snap-action. Tap = quick
// flip; drag the lever and it resists, then snaps past center — the event (a
// two-part clack) fires at the center crossing, not on touch. One decisive
// haptic at the snap; the resistance phase has none, and that contrast sells it.
const COUNT = 4;
const ANGLE = 0.6; // lever tilt each way

export class FlipStation extends Station {
  get title() { return 'Flip'; }
  get index() { return '05'; }
  frame() { return { y: 0.95, halfW: 2.3, halfH: 1.25 }; }

  build() {
    this.state = this.load('flip.state', new Array(COUNT).fill(false));
    if (this.state.length !== COUNT) this.state = new Array(COUNT).fill(false);

    const plateMat = new THREE.MeshPhysicalMaterial({ color: 0xeceef1, roughness: 0.5 });
    const leverMat = new THREE.MeshPhysicalMaterial({ color: 0x33363d, roughness: 0.35, metalness: 0.3 });

    const plate = new THREE.Mesh(new THREE.BoxGeometry(COUNT * 0.95 + 0.4, 1.7, 0.25), plateMat);
    plate.position.y = 0.95; plate.castShadow = plate.receiveShadow = true;
    this.group.add(plate);

    this.switches = [];
    this.interactive = [];
    const half = (COUNT - 1) / 2;
    for (let i = 0; i < COUNT; i++) {
      const x = (i - half) * 0.95;
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.95, 0.12);
      this.group.add(pivot);

      const lever = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 8, 16), leverMat);
      lever.position.y = 0.32; lever.castShadow = true;
      lever.userData.idx = i;
      pivot.add(lever);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 16), leverMat);
      knob.position.y = 0.62; knob.userData.idx = i; pivot.add(knob);

      // Indicator LED below each switch.
      const ledMat = new THREE.MeshStandardMaterial({ color: 0x224, emissive: 0x6ea8fe, emissiveIntensity: 0.1 });
      const led = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), ledMat);
      led.position.set(x, 0.4, 0.14);
      this.group.add(led);

      const spring = new Spring(320, 18, this.state[i] ? ANGLE : -ANGLE);
      this.switches.push({ pivot, spring, ledMat, x });
      this.interactive.push(lever, knob);
    }

    this.group.add(Stage.contactShadow(COUNT * 0.6, 0.45));
    this.active = -1;
  }

  onDown(hit) {
    this.active = hit?.object.userData.idx ?? -1;
    this.startY = null;
    this.toggled = false;
  }

  onMove(hit, ndc) {
    if (this.active < 0 || this.toggled) return;
    if (this.startY == null) this.startY = ndc.y;
    const dy = ndc.y - this.startY;
    const on = this.state[this.active];
    // Must drag in the direction that fights the current state.
    if ((!on && dy > 0.06) || (on && dy < -0.06)) this._toggle(this.active);
  }

  onUp() {
    if (this.active >= 0 && !this.toggled) this._toggle(this.active); // tap
    this.active = -1;
  }

  _toggle(i) {
    this.toggled = true;
    const sw = this.switches[i];
    this.state[i] = !this.state[i];
    this.save('flip.state', this.state);
    sw.spring.set(this.state[i] ? ANGLE : -ANGLE);
    sw.spring.v += (this.state[i] ? 1 : -1) * 6; // kick = accelerating snap
    sw.ledMat.emissiveIntensity = this.state[i] ? 1.6 : 0.1;
    this.ctx.feedback.emit({ type: 'switch-snap', intensity: 0.9, pitch: this.state[i] ? 1.05 : 0.9, pan: sw.x / 3 });
  }

  update(dt) {
    for (const sw of this.switches) {
      sw.pivot.rotation.x = -sw.spring.update(dt);
      sw.ledMat.emissiveIntensity += ((sw.spring.target > 0 ? 1.4 : 0.1) - sw.ledMat.emissiveIntensity) * Math.min(1, dt * 6);
    }
  }

  info() { return `${this.state.filter(Boolean).length}/${COUNT} on`; }
}
