import * as THREE from 'three';
import { Station } from './base.js';
import { Spring } from '../spring.js';
import { Stage } from '../stage.js';

// 02 — Click. A big satisfying push-button with a counter.
// Two-stage travel: pre-travel, a defined ACTUATION point where the click
// event fires (not at touch-down), then bottom-out. Release clicks too, lighter.
const ACTUATE = 0.55;       // point in travel (0 up -> 1 down) where the click fires
const RESET = 0.35;         // point where the release click fires on the way up
const DEPTH = 0.16;         // world depth of full travel

export class ClickStation extends Station {
  get title() { return 'Click'; }
  get index() { return '02'; }

  build() {
    this.count = this.load('click.count', 0);

    const white = new THREE.MeshPhysicalMaterial({ color: 0xf2f3f5, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.4 });
    const dark = new THREE.MeshPhysicalMaterial({ color: 0x2a2d34, roughness: 0.6, metalness: 0.1 });

    // Base housing.
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.45, 64), dark);
    base.position.y = 0.225;
    base.castShadow = base.receiveShadow = true;
    this.group.add(base);

    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.12, 64), white);
    collar.position.y = 0.5;
    collar.receiveShadow = true;
    this.group.add(collar);

    // LED ring — snaps bright at actuation.
    this.ledMat = new THREE.MeshStandardMaterial({ color: 0x16306a, emissive: 0x6ea8fe, emissiveIntensity: 0.15 });
    const led = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.045, 16, 80), this.ledMat);
    led.rotation.x = Math.PI / 2;
    led.position.y = 0.5;
    this.group.add(led);

    // The button cap.
    this.button = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.86, 0.4, 64), white);
    this.button.castShadow = true;
    this.buttonRestY = 0.74;
    this.button.position.y = this.buttonRestY;
    this.group.add(this.button);

    this.interactive = [this.button];

    this.group.add(Stage.contactShadow(1.5, 0.55));

    this.spring = new Spring(260, 26, 0); // 0 = up, 1 = down
    this.prev = 0;
    this.pressed = false;
    this.lastClickT = 0;
    this.streak = 1;        // pitch/brightness multiplier for fast clicking
    this.holdTimer = null;
  }

  onDown(hit, ndc) {
    this.pressed = true;
    this.spring.set(1);
    // Long-press to reset the counter.
    this.holdTimer = setTimeout(() => {
      this.count = 0; this.save('click.count', 0); this.refreshStat();
      this.ctx.feedback.emit({ type: 'thud', intensity: 0.7 });
      this.streak = 1;
    }, 750);
  }

  onUp() {
    this.pressed = false;
    this.spring.set(0);
    clearTimeout(this.holdTimer);
  }

  _flashLed(intensity) {
    this.ledMat.emissiveIntensity = 0.15 + 2.4 * intensity;
  }

  update(dt, t) {
    const v = this.spring.update(dt);
    // Hard stop at the bottom — no rubber-banding past full travel.
    if (v > 1) { this.spring.value = 1; this.spring.v = Math.min(0, this.spring.v); }
    const cur = Math.max(0, this.spring.value);
    this.button.position.y = this.buttonRestY - cur * DEPTH;

    // Discrete events fire from the travel crossing a threshold, not from touch.
    if (this.prev < ACTUATE && cur >= ACTUATE && this.pressed) {
      this._actuate(t);
    }
    if (this.prev > RESET && cur <= RESET && !this.pressed) {
      this.ctx.feedback.emit({ type: 'click-up', intensity: 0.5, pitch: 1.1 });
    }
    this.prev = cur;

    // LED decay.
    this.ledMat.emissiveIntensity += (0.15 - this.ledMat.emissiveIntensity) * Math.min(1, dt * 8);
  }

  _actuate(t) {
    const gap = t - this.lastClickT;
    this.lastClickT = t;
    this.streak = gap < 0.45 ? Math.min(2.2, this.streak + 0.18) : 1;

    this.count++;
    this.save('click.count', this.count);
    this.refreshStat();

    this.ctx.feedback.emit({
      type: 'click-down',
      intensity: 0.85,
      pitch: 0.95 + 0.12 * this.streak,
      visual: () => this._flashLed(this.streak / 2.2),
    });
    // Warmer LED hue as the streak builds.
    const warm = (this.streak - 1) / 1.2;
    this.ledMat.emissive.setHSL(0.6 - 0.18 * warm, 0.8, 0.55);
  }

  info() {
    return `<span class="num">${this.count}</span>clicks`;
  }
}
