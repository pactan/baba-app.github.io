import * as THREE from 'three';
import { Station } from './base.js';
import { Spring } from '../spring.js';
import { Stage } from '../stage.js';
import { rbox } from '../util.js';

// 01 — Pop. A 5x5 silicone bubble grid standing up to face you. Tap a bubble to
// pop it through to a concave dimple; tap again pops it back. Drag across bubbles
// to sweep-pop a run with a rising pitch ladder. Tap-hold resets with a cascade.
const N = 5;
const GAP = 0.42;
const CY = 1.1;            // vertical center of the grid

export class PopStation extends Station {
  get title() { return 'Pop'; }
  get index() { return '01'; }
  frame() { return { y: CY, halfW: 1.4, halfH: 1.4 }; }

  build() {
    this.count = this.load('pop.count', 0);

    const silicone = new THREE.MeshPhysicalMaterial({
      color: 0xe7484f, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.5, sheen: 0.6, sheenColor: 0xff8a8f,
    });

    // Backing panel behind the bubbles.
    const span = (N - 1) * GAP + 0.7;
    const plate = new THREE.Mesh(
      rbox(span, span, 0.24, 0.12),
      new THREE.MeshPhysicalMaterial({ color: 0xd23b42, roughness: 0.55, clearcoat: 0.3 })
    );
    plate.position.set(0, CY, -0.14);
    plate.receiveShadow = true;
    plate.castShadow = true;
    this.group.add(plate);

    this.bubbles = [];
    this.interactive = [];
    const half = (N - 1) / 2;
    // Hemisphere pointing +Y; rotated to point +Z (toward the camera).
    const geo = new THREE.SphereGeometry(0.2, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2);

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const m = new THREE.Mesh(geo, silicone);
        m.castShadow = true;
        m.rotation.x = Math.PI / 2;
        m.position.set((c - half) * GAP, CY + (half - r) * GAP, 0);
        m.userData = {
          spring: new Spring(220, 16, 0), // 0 = domed toward you, 1 = popped through
          popped: false,
          baseZ: 0,
          pitch: 1 + (r * N + c) * 0.02,  // sweep pitch ladder, top-left -> bottom-right
        };
        this.group.add(m);
        this.bubbles.push(m);
        this.interactive.push(m);
      }
    }

    this.group.add(Stage.contactShadow(span * 0.7, 0.45));

    this.ripples = new RipplePool(this.group, 6);
    this.holdTimer = null;
    this.sweptThisGesture = new Set();
    this.dragging = false;
  }

  _pop(bubble, forceState) {
    const d = bubble.userData;
    const popped = forceState == null ? !d.popped : forceState;
    if (popped === d.popped) return;
    d.popped = popped;
    d.spring.set(popped ? 1 : 0);

    if (popped) { this.count++; this.save('pop.count', this.count); this.refreshStat(); }

    const reduced = this.ctx.settings.reducedMotion;
    this.ctx.feedback.emit({
      type: popped ? 'pop-in' : 'pop-out',
      intensity: popped ? 0.9 : 0.6,
      pitch: (popped ? 1.15 : 0.9) * d.pitch,
      pan: bubble.position.x / 3,
      visual: reduced ? null : () => this.ripples.fire(bubble.position),
    });
  }

  onDown(hit) {
    if (!hit) return;
    this.dragging = true;
    this.sweptThisGesture.clear();
    const b = hit.object;
    this.sweptThisGesture.add(b);
    this._pop(b);
    this.holdTimer = setTimeout(() => this._resetAll(), 650);
  }

  onMove(hit) {
    if (!this.dragging || !hit) return;
    const b = hit.object;
    if (this.sweptThisGesture.has(b)) return;
    this.sweptThisGesture.add(b);
    clearTimeout(this.holdTimer);
    this._pop(b, true);
  }

  onUp() {
    this.dragging = false;
    clearTimeout(this.holdTimer);
  }

  _resetAll() {
    let i = 0;
    for (const b of this.bubbles) {
      if (!b.userData.popped) continue;
      setTimeout(() => this._pop(b, false), (i++) * 22);
    }
  }

  update(dt) {
    for (const b of this.bubbles) {
      const d = b.userData;
      const v = d.spring.update(dt);
      // Push the dome back and flip it inside-out as it crosses through.
      b.position.z = d.baseZ - v * 0.16;
      const s = 1 - v * 2;                 // +1 (toward you) -> -1 (concave)
      b.scale.y = Math.abs(s) < 0.04 ? 0.04 : s;
      const bulge = 1 + 0.12 * Math.sin(Math.min(v, 0.5) * Math.PI); // anticipation squash
      b.scale.x = b.scale.z = bulge;
    }
    this.ripples.update(dt);
  }

  info() { return `<span class="num">${this.count}</span>pops`; }
}

// A pool of expanding/fading rings (facing the camera) reused across pops.
class RipplePool {
  constructor(parent, n) {
    this.items = [];
    const geo = new THREE.RingGeometry(0.16, 0.22, 32);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffd0d2, transparent: true, opacity: 0, depthWrite: false });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      parent.add(m);
      this.items.push({ mesh: m, life: 0 });
    }
    this.cursor = 0;
  }

  fire(pos) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    it.mesh.position.set(pos.x, pos.y, 0.12);
    it.mesh.visible = true;
    it.life = 1;
  }

  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt * 3;
      const s = 0.6 + (1 - Math.max(0, it.life)) * 2.2;
      it.mesh.scale.set(s, s, s);
      it.mesh.material.opacity = Math.max(0, it.life) * 0.7;
      if (it.life <= 0) it.mesh.visible = false;
    }
  }
}
