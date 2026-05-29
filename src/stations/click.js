import * as THREE from 'three';
import { Station } from './base.js';
import { Spring } from '../spring.js';
import { Stage } from '../stage.js';
import { M, lathe, knurled, screwHead, clamp } from '../util.js';

// 02 — Click. A premium machined desk clicker. A turned aluminium base (lathe:
// wide low cone with a chamfered foot), a knurled retaining collar, a
// translucent LED ring seated in a groove that snaps bright at actuation and
// fades, and a satin plastic button cap with a chamfered top and a thumb dish.
//
// Mechanics: two-stage travel driven by a Spring (0 up -> 1 down). The click
// fires at the ACTUATION crossing (~0.55) on the way down — never at touch —
// and a lighter click at the RESET crossing (~0.35) on the way up. Hard
// bottom-out (clamp <= 1). The spring is lightly damped so it overshoots on
// return. Rapid clicking builds a streak that warms the LED hue + raises pitch;
// a long-press (~750ms) resets the counter with a thud. count persisted.
const ACTUATE = 0.55;       // travel point (0 up -> 1 down) where the click fires
const RESET = 0.35;         // travel point where the release click fires on the way up
const DEPTH = 0.18;         // world depth of full travel
const HOLD_MS = 750;

export class ClickStation extends Station {
  get title() { return 'Click'; }
  get index() { return '02'; }
  frame() { return { y: 0.6, halfW: 1.5, halfH: 0.95 }; }

  build() {
    this.count = this.load('click.count', 0);

    // ---- turned aluminium base: wide low cone with a chamfered foot ----------
    // Lathe profile (radius, y) revolved into a single seamless turned part.
    const baseMat = M.alu(0xc6cbd3);
    const base = lathe([
      [0.00, 0.00],
      [1.36, 0.00],   // foot outer edge
      [1.40, 0.03],
      [1.40, 0.06],
      [1.30, 0.10],   // foot bevel up to the body
      [1.22, 0.13],
      [1.18, 0.16],
      [0.98, 0.34],   // cone wall rising
      [0.93, 0.39],
      [0.90, 0.44],   // top shoulder
      [0.86, 0.46],   // groove lip the collar seats against
      [0.00, 0.46],
    ], baseMat, 96);
    base.castShadow = base.receiveShadow = true;
    this.group.add(base);

    // Soft-touch rubber foot ring underneath so it never floats.
    const foot = lathe([
      [0.55, 0.0], [1.32, 0.0], [1.32, 0.022], [0.55, 0.022], [0.55, 0.0],
    ], M.rubber(0x16181d), 64);
    foot.position.y = 0.001;
    this.group.add(foot);

    // Polished accent ring nested where the cone meets the shoulder.
    const accent = lathe([
      [0.90, 0.435], [0.935, 0.45], [0.935, 0.475], [0.90, 0.485], [0.90, 0.435],
    ], M.polishedSteel(), 96);
    accent.castShadow = true;
    this.group.add(accent);

    // ---- LED ring seated in a groove around the base of the collar ----------
    // Drawn slightly forward of the metal so the emissive face never z-fights.
    this.ledMat = M.led(0x6ea8fe, 0.2);
    this.ledMat.transparent = true;
    this.ledMat.opacity = 0.94;
    const led = new THREE.Mesh(new THREE.TorusGeometry(0.825, 0.06, 28, 120), this.ledMat);
    led.rotation.x = Math.PI / 2;
    led.position.y = 0.50;
    this.group.add(led);
    this.ledRing = led;
    // A dim diffuser ring behind the LED so its glow reads as a seated lens.
    const diff = new THREE.Mesh(new THREE.TorusGeometry(0.825, 0.075, 20, 80),
      M.plastic(0x20242c, { roughness: 0.5, clearcoat: 0.3 }));
    diff.rotation.x = Math.PI / 2;
    diff.position.y = 0.49;
    this.group.add(diff);
    this.ledHue = 0.6; // base blue

    // ---- knurled retaining collar the button rides inside -------------------
    const collarMat = knurled(M.darkMetal(0x3a3e46), 44, 0.006);
    const collar = lathe([
      [0.78, 0.50],
      [0.88, 0.52],
      [0.88, 0.66],
      [0.82, 0.71],   // top chamfer
      [0.74, 0.71],
      [0.74, 0.50],
    ], collarMat, 96);
    collar.castShadow = collar.receiveShadow = true;
    this.group.add(collar);

    // Tiny polished screws set into the shoulder for finished hardware detail.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const s = screwHead(0.05, M.polishedSteel());
      s.position.set(Math.cos(a) * 1.04, 0.30, Math.sin(a) * 1.04);
      s.lookAt(s.position.x * 2, 0.30, s.position.z * 2);
      this.group.add(s);
    }

    // ---- the button group: turned cap + chamfered top + thumb dish ----------
    this.button = new THREE.Group();
    this.buttonRestY = 0.50;
    this.button.position.y = this.buttonRestY;

    const capMat = M.plastic(0xf3f4f6, { clearcoat: 0.85, clearcoatRoughness: 0.22 });
    // Profile measured from the button's local origin (y from 0 up). Includes a
    // closed underside (radius returns to 0) so it's solid from below on orbit.
    const cap = lathe([
      [0.00, 0.235],
      [0.46, 0.235],   // flat-ish crown
      [0.60, 0.205],   // chamfered top edge
      [0.70, 0.165],
      [0.72, 0.10],
      [0.72, -0.02],   // skirt disappears into the collar
      [0.66, -0.06],
      [0.00, -0.06],   // closed bottom
    ], capMat, 96);
    cap.castShadow = true;
    this.button.add(cap);

    // Concave thumb dish on top (reads from above on orbit). Drawn just proud of
    // the crown so it doesn't z-fight the cap.
    const dish = lathe([
      [0.00, 0.236],
      [0.24, 0.242],
      [0.40, 0.256],
      [0.46, 0.258],
    ], M.plastic(0xeceef1, { clearcoat: 0.9, clearcoatRoughness: 0.18 }), 96);
    this.button.add(dish);

    // A thin satin grip ring near the cap shoulder.
    const grip = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.024, 18, 90),
      M.darkMetal(0x4a4e57));
    grip.rotation.x = Math.PI / 2;
    grip.position.y = 0.135;
    this.button.add(grip);

    this.group.add(this.button);

    // Invisible grab cylinder covering the whole cap so taps register anywhere.
    const grab = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.55, 24),
      new THREE.MeshBasicMaterial({ visible: false }));
    grab.position.y = 0.6;
    this.group.add(grab);
    this.interactive = [grab];

    this.group.add(Stage.contactShadow(1.65, 0.55));

    this.spring = new Spring(320, 20, 0); // 0 = up, 1 = down; light damping => overshoot
    this.prev = 0;
    this.pressed = false;
    this.lastClickT = 0;
    this.streak = 1;        // pitch/brightness multiplier for fast clicking
    this.holdTimer = null;
  }

  onDown() {
    this.pressed = true;
    this.spring.set(1.08);  // drive past 1 so the bottom-out clamp engages
    clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => {
      this.count = 0; this.save('click.count', 0); this.refreshStat();
      this.streak = 1; this.ledHue = 0.6;
      this.ledMat.emissive.setHSL(this.ledHue, 0.85, 0.58);
      this.ctx.feedback.emit({ type: 'thud', intensity: 0.78 });
    }, HOLD_MS);
  }

  onUp() {
    this.pressed = false;
    this.spring.set(0);
    clearTimeout(this.holdTimer);
  }

  onLeave() {
    this.pressed = false;
    this.spring.set(0);
    clearTimeout(this.holdTimer);
  }

  _flashLed(intensity) {
    this.ledMat.emissiveIntensity = 0.2 + 2.8 * intensity;
  }

  update(dt) {
    this.spring.update(dt);
    // Hard bottom-out: clamp travel <= 1, kill downward velocity at the floor.
    if (this.spring.value > 1) { this.spring.value = 1; this.spring.v = Math.min(0, this.spring.v); }
    const shown = clamp(this.spring.value, 0, 1);
    this.button.position.y = this.buttonRestY - shown * DEPTH;

    // Threshold-crossing events (derived from travel, never from raw touch).
    if (this.prev < ACTUATE && shown >= ACTUATE && this.pressed) {
      this._actuate(performance.now() / 1000);
    }
    if (this.prev > RESET && shown <= RESET && !this.pressed) {
      this.ctx.feedback.emit({ type: 'click-up', intensity: 0.5, pitch: 1.12 });
      this._flashLed(0.12);
    }
    this.prev = shown;

    // LED decay back to its (streak-warmed) idle glow.
    const idle = 0.2 + 0.14 * (this.streak - 1);
    this.ledMat.emissiveIntensity += (idle - this.ledMat.emissiveIntensity) * Math.min(1, dt * 7);
  }

  _actuate(t) {
    const gap = t - this.lastClickT;
    this.lastClickT = t;
    this.streak = gap < 0.45 ? Math.min(2.6, this.streak + 0.22) : 1;

    this.count++;
    this.save('click.count', this.count);
    this.refreshStat();

    const warm = clamp((this.streak - 1) / 1.6, 0, 1);  // 0 cool .. 1 warm
    this.ledHue = 0.6 - 0.24 * warm;
    this.ledMat.emissive.setHSL(this.ledHue, 0.85, 0.58);

    this.ctx.feedback.emit({
      type: 'click-down',
      intensity: 0.88,
      pitch: 0.95 + 0.13 * this.streak,
      visual: () => this._flashLed(0.45 + 0.55 * warm),
    });
  }

  info() { return `<span class="num">${this.count}</span>clicks`; }
}
