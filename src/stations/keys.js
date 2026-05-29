import * as THREE from 'three';
import { Station } from './base.js';
import { Spring } from '../spring.js';
import { Stage } from '../stage.js';
import { rbox } from '../util.js';

// 08 — Keys. Mechanical keycaps + a digital display. Switch feel per key:
// linear (no bump), tactile (bump partway), clicky (sharp click). The sound +
// haptic fire at the ACTUATION point mid-travel, not at touch; a lighter sound
// fires at the reset point on release. RGB ripples out from each press.
const KEYS = [
  { ch: 'F', type: 'clicky', hue: 0.58 },
  { ch: 'I', type: 'tactile', hue: 0.32 },
  { ch: 'D', type: 'linear', hue: 0.0 },
  { ch: 'G', type: 'tactile', hue: 0.82 },
  { ch: 'T', type: 'clicky', hue: 0.13 },
];
const DEPTH = 0.18, ACTUATE = 0.45, RESET = 0.3;

export class KeysStation extends Station {
  get title() { return 'Keys'; }
  get index() { return '08'; }
  frame() { return { y: 1.05, halfW: 1.8, halfH: 1.25 }; }

  build() {
    this.text = '';
    const caseMat = new THREE.MeshPhysicalMaterial({ color: 0x23262d, roughness: 0.5, metalness: 0.2 });
    const board = new THREE.Mesh(rbox(KEYS.length * 0.62 + 0.4, 0.34, 1.0, 0.08), caseMat);
    board.position.set(0, 0.45, 0); board.castShadow = board.receiveShadow = true;
    this.group.add(board);

    this.keys = [];
    this.interactive = [];
    const half = (KEYS.length - 1) / 2;
    for (let i = 0; i < KEYS.length; i++) {
      const def = KEYS[i];
      const x = (i - half) * 0.62;
      // Sculpted (slightly dished, tapered) keycap.
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.27, 0.22, 4),
        new THREE.MeshPhysicalMaterial({ color: 0xf2f3f5, roughness: 0.45, clearcoat: 0.3 }));
      cap.rotation.y = Math.PI / 4;
      cap.position.set(x, 0.72, 0);
      cap.castShadow = true;
      cap.userData.idx = i;
      this.group.add(cap);

      // Per-key RGB underglow.
      const glowMat = new THREE.MeshStandardMaterial({ color: 0x000, emissive: new THREE.Color().setHSL(def.hue, 0.9, 0.5), emissiveIntensity: 0.2 });
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.5), glowMat);
      glow.position.set(x, 0.61, 0);
      this.group.add(glow);

      this.keys.push({
        def, cap, glowMat, x, baseY: 0.72,
        spring: new Spring(300, 24, 0), prev: 0, pressed: false, ripple: 0,
      });
      this.interactive.push(cap);
    }

    // Digital display panel.
    this.screen = new TextScreen();
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.7), this.screen.material);
    panel.position.set(0, 1.7, -0.3);
    this.group.add(panel);
    const bezel = new THREE.Mesh(rbox(2.6, 0.9, 0.12, 0.05), caseMat);
    bezel.position.set(0, 1.7, -0.36); this.group.add(bezel);

    this.group.add(Stage.contactShadow(KEYS.length * 0.4, 0.45));
    this.active = -1;
    this.caretT = 0;
  }

  onDown(hit) {
    const i = hit?.object.userData.idx;
    if (i == null) return;
    this.active = i;
    this.keys[i].pressed = true;
    this.keys[i].spring.set(1);
  }

  onUp() {
    if (this.active >= 0) { this.keys[this.active].pressed = false; this.keys[this.active].spring.set(0); }
    this.active = -1;
  }

  _actuate(k) {
    const clicky = k.def.type === 'clicky';
    this.ctx.feedback.emit({
      type: 'key',
      intensity: clicky ? 0.95 : k.def.type === 'tactile' ? 0.75 : 0.55,
      pitch: 0.9 + (k.def.hue) * 0.4 + (clicky ? 0.2 : 0),
      pan: k.x / 3,
    });
    k.ripple = 1;
    this.text = (this.text + k.def.ch).slice(-14);
    this.screen.draw(this.text);
    this.refreshStat();
  }

  update(dt) {
    this.caretT += dt;
    for (const k of this.keys) {
      const v = Math.max(0, k.spring.update(dt));
      if (v > 1) { k.spring.value = 1; k.spring.v = Math.min(0, k.spring.v); }
      k.cap.position.y = k.baseY - Math.min(1, v) * DEPTH;

      // Actuation / release fire from travel crossing thresholds.
      if (k.prev < ACTUATE && v >= ACTUATE && k.pressed) this._actuate(k);
      if (k.prev > RESET && v <= RESET && !k.pressed) {
        this.ctx.feedback.emit({ type: 'key-up', intensity: 0.4, pitch: 1.1, pan: k.x / 3 });
      }
      k.prev = v;

      // RGB ripple spreads to neighbours via a small per-key decay + distance delay.
      k.ripple = Math.max(0, k.ripple - dt * 2.5);
      let glow = 0.2 + k.ripple * 2.0;
      for (const o of this.keys) {
        if (o === k || o.ripple <= 0) continue;
        const dist = Math.abs(o.x - k.x);
        glow = Math.max(glow, 0.2 + Math.max(0, o.ripple - dist * 1.2) * 1.4);
      }
      k.glowMat.emissiveIntensity += (glow - k.glowMat.emissiveIntensity) * Math.min(1, dt * 12);
    }
    this.screen.blink(this.caretT);
  }

  info() { return this.text ? `“${this.text}”` : 'type something'; }
}

// A tiny canvas-backed display with a blinking caret.
class TextScreen {
  constructor() {
    this.cv = document.createElement('canvas');
    this.cv.width = 512; this.cv.height = 150;
    this.g = this.cv.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.cv);
    this.material = new THREE.MeshBasicMaterial({ map: this.tex });
    this.text = '';
    this.draw('');
  }
  draw(text, caret = true) {
    this.text = text;
    const g = this.g;
    g.fillStyle = '#06120c'; g.fillRect(0, 0, 512, 150);
    g.fillStyle = '#39ff88';
    g.font = '600 64px ui-monospace, Menlo, monospace';
    g.textBaseline = 'middle';
    g.fillText(text + (caret ? '_' : ' '), 18, 80);
    this.tex.needsUpdate = true;
  }
  blink(t) {
    const on = Math.floor(t * 2) % 2 === 0;
    if (on !== this._lastOn) { this._lastOn = on; this.draw(this.text, on); }
  }
}
