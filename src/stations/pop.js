import * as THREE from 'three';
import { Station } from './base.js';
import { Spring } from '../spring.js';
import { Stage } from '../stage.js';
import { M, rbox, lathe, clamp } from '../util.js';

// 01 — Pop. A vertical 5x5 silicone pop-it pad facing the camera. The pad is a
// rounded soft-touch slab with a turned raised rim and a recessed bubble field.
// Each bubble is a proper LOW dome (a flattened hemisphere) that snaps THROUGH
// to a concave dimple — flipped along the view axis through zero — with a tiny
// squash of anticipation as it passes flat, plus a neighbour ripple so the
// sheet feels like one piece of silicone.
//
// Mechanics:
//   - tap toggles a bubble (pop in / pop out)
//   - drag-sweep pops a run with a rising pitch ladder (top-left -> bottom-right)
//   - tap-hold (~650ms) resets every popped bubble in a diagonal cascade
//   - pop-in is higher / snappier; pop-out is lower / softer
//   - count is persisted under 'pop.count'
const N = 5;                 // grid is N x N
const GAP = 0.45;            // spacing between bubble centres
const CY = 1.1;              // vertical centre of the pad
const DOME_R = 0.20;         // bubble footprint radius
const DOME_H = 0.125;        // resting dome height (a LOW dome, not a sphere)
const FACE_Z = 0.16;         // z of the recessed silicone face the domes sit on
const HOLD_MS = 650;

export class PopStation extends Station {
  get title() { return 'Pop'; }
  get index() { return '01'; }
  frame() { return { y: CY, halfW: 1.4, halfH: 1.4 }; }

  build() {
    this.count = this.load('pop.count', 0);

    const span = (N - 1) * GAP;              // centre-to-centre extent
    const inner = span + 2 * DOME_R + 0.10;  // recessed field size
    const padW = inner + 0.42;               // full pad incl. rim
    const padZ = -0.06;                      // back face of the slab body

    // ---- backing pad: a soft-touch silicone slab, rounded on every edge ------
    // Slight back taper read via a second thinner slab so it never looks hollow
    // from behind on orbit.
    const bodyMat = M.soft(0xe7484f, { clearcoat: 0.45, clearcoatRoughness: 0.5, roughness: 0.55 });
    const pad = new THREE.Mesh(rbox(padW, padW, 0.30, 0.16, 6), bodyMat);
    pad.position.set(0, CY, padZ - 0.05);
    pad.castShadow = pad.receiveShadow = true;
    this.group.add(pad);

    // A gently domed back so the rear reads as a finished moulded part.
    const back = new THREE.Mesh(rbox(padW - 0.18, padW - 0.18, 0.10, 0.16, 5),
      M.soft(0xc9343b, { roughness: 0.62 }));
    back.position.set(0, CY, padZ - 0.24);
    back.castShadow = back.receiveShadow = true;
    this.group.add(back);

    // ---- raised turned rim framing the field --------------------------------
    // A square rounded frame built from four bars with mitred rounding, sitting
    // just proud of the recessed face so the bubble field sits in a tray.
    const rimMat = M.soft(0xcf373e, { clearcoat: 0.55, roughness: 0.5 });
    const rimT = 0.20, rimH = 0.20, rimZ = FACE_Z + 0.04;
    const half = padW / 2 - rimT / 2 - 0.01;
    const barH = rbox(padW - 0.02, rimT, rimH, 0.08, 5);
    const barV = rbox(rimT, padW - 2 * rimT, rimH, 0.08, 5);
    for (const [g, x, y] of [
      [barH, 0, half], [barH, 0, -half],
      [barV, -half, 0], [barV, half, 0],
    ]) {
      const bar = new THREE.Mesh(g, rimMat);
      bar.position.set(x, CY + y, rimZ);
      bar.castShadow = bar.receiveShadow = true;
      this.group.add(bar);
    }
    // Rounded corner caps so the frame reads continuous from any angle.
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(rimT * 0.62, 20, 16), rimMat);
      cap.scale.set(1, 1, 0.7);
      cap.position.set(sx * half, CY + sy * half, rimZ);
      cap.castShadow = true;
      this.group.add(cap);
    }

    // ---- recessed inner face the bubbles emerge from ------------------------
    const face = new THREE.Mesh(
      rbox(inner, inner, 0.06, 0.06, 4),
      M.soft(0xc2333a, { roughness: 0.66, clearcoat: 0.15 })
    );
    face.position.set(0, CY, FACE_Z - 0.03);
    face.receiveShadow = true;
    this.group.add(face);

    // ---- bubbles ------------------------------------------------------------
    // A low dome: a hemisphere whose origin is at its base centre so flipping
    // scale along the dome axis inverts it cleanly into a concave dimple.
    const domeGeo = new THREE.SphereGeometry(DOME_R, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
    const skirtGeo = new THREE.CylinderGeometry(DOME_R, DOME_R * 0.96, 0.05, 40, 1, true);
    const siliconeBubble = M.soft(0xf0625f, { clearcoat: 0.6, clearcoatRoughness: 0.3, roughness: 0.42 });

    this.bubbles = [];
    this.interactive = [];
    const c0 = (N - 1) / 2;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const x = (c - c0) * GAP;
        const y = CY + (c0 - r) * GAP;

        // A little wrapper so the dome + a tiny base skirt move together; the
        // skirt hides the seam where the dome meets the recessed face.
        const cell = new THREE.Group();
        cell.position.set(x, y, FACE_Z);

        const dome = new THREE.Mesh(domeGeo, siliconeBubble);
        dome.castShadow = true;
        // Lay the hemisphere down so its dome points +Z (toward the camera).
        dome.rotation.x = Math.PI / 2;
        dome.scale.set(1, DOME_H / DOME_R, 1); // flatten along the (rotated) dome axis
        cell.add(dome);

        const skirt = new THREE.Mesh(skirtGeo, siliconeBubble);
        skirt.rotation.x = Math.PI / 2;
        skirt.position.z = -0.01;
        skirt.castShadow = true;
        cell.add(skirt);

        cell.userData = {
          col: c, row: r, dome, skirt,
          spring: new Spring(260, 14, 0),  // 0 = domed out, 1 = popped in
          popped: false,
          rest: 0,                          // ripple wobble offset
          pitch: 1 + (r * N + c) * (0.95 / (N * N)), // ladder top-left -> bottom-right
        };
        this.group.add(cell);
        this.bubbles.push(cell);
        this.interactive.push(dome); // raycast the visible dome
        dome.userData.cell = cell;   // back-reference for hit handling
      }
    }
    // index helper for neighbour ripple
    this.at = (r, c) => (r < 0 || c < 0 || r >= N || c >= N) ? null : this.bubbles[r * N + c];

    this.group.add(Stage.contactShadow(padW * 0.6, 0.42));

    this.ripples = new RipplePool(this.group, 8);
    this.holdTimer = null;
    this.sweptThisGesture = new Set();
    this.dragging = false;
  }

  _cellOf(hit) {
    if (!hit || !hit.object) return null;
    return hit.object.userData.cell || null;
  }

  _pop(cell, forceState) {
    const d = cell.userData;
    const popped = forceState == null ? !d.popped : forceState;
    if (popped === d.popped) return;
    d.popped = popped;
    // Kick the spring with a little anticipation velocity so it overshoots and
    // snaps through the flat midpoint rather than easing.
    d.spring.v = popped ? 6 : -6;
    d.spring.set(popped ? 1 : 0);

    if (popped) { this.count++; this.save('pop.count', this.count); this.refreshStat(); }

    const reduced = this.ctx.settings.reducedMotion;

    // Neighbour ripple: a tiny springy nudge so the field feels like one sheet.
    if (!reduced) {
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nb = this.at(d.row + dr, d.col + dc);
        if (nb) nb.userData.rest = popped ? -0.045 : 0.04;
      }
    }

    this.ctx.feedback.emit({
      type: popped ? 'pop-in' : 'pop-out',
      intensity: popped ? 0.92 : 0.6,
      pitch: (popped ? 1.18 : 0.86) * d.pitch,
      pan: clamp(cell.position.x / 3, -1, 1),
      visual: reduced ? null : () => this.ripples.fire(cell.position.x, cell.position.y),
    });
  }

  onDown(hit) {
    const cell = this._cellOf(hit);
    if (!cell) return;
    this.dragging = true;
    this.sweptThisGesture.clear();
    this.sweptThisGesture.add(cell);
    this._pop(cell);
    clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => this._resetAll(), HOLD_MS);
  }

  onMove(hit) {
    if (!this.dragging) return;
    const cell = this._cellOf(hit);
    if (!cell || this.sweptThisGesture.has(cell)) return;
    this.sweptThisGesture.add(cell);
    clearTimeout(this.holdTimer); // a drag is not a hold
    this._pop(cell, true);        // sweep always pops in
  }

  onUp() {
    this.dragging = false;
    clearTimeout(this.holdTimer);
  }

  onLeave() {
    this.dragging = false;
    clearTimeout(this.holdTimer);
  }

  _resetAll() {
    // Diagonal cascade so it ripples across the pad rather than all at once.
    const popped = this.bubbles.filter((b) => b.userData.popped);
    for (const b of popped) {
      const d = b.userData;
      const delay = (d.row + d.col) * 32;
      setTimeout(() => this._pop(b, false), delay);
    }
  }

  update(dt) {
    for (const cell of this.bubbles) {
      const d = cell.userData;
      const v = d.spring.update(dt);

      // s goes +1 (domed out toward you) through 0 (flat) to -1 (concave in).
      const s = 1 - v * 2;
      const mag = Math.max(0.04, Math.abs(s));
      const dir = s < 0 ? -1 : 1;
      d.dome.scale.y = dir * mag * (DOME_H / DOME_R);

      // Anticipation: footprint bulges as it passes through the flat midpoint.
      const through = Math.sin(clamp(v, 0, 1) * Math.PI); // 0..1..0
      const bulge = 1 + 0.16 * through;
      d.dome.scale.x = d.dome.scale.z = bulge;
      d.skirt.scale.set(bulge, 1, bulge);

      // Settle the neighbour wobble back to rest.
      d.rest += (0 - d.rest) * Math.min(1, dt * 12);
      cell.position.z = FACE_Z + d.rest - v * 0.02;
    }
    this.ripples.update(dt);
  }

  info() { return `<span class="num">${this.count}</span>pops`; }
}

// A pool of expanding/fading rings (facing the camera) reused across pops.
class RipplePool {
  constructor(parent, n) {
    this.items = [];
    const geo = new THREE.RingGeometry(0.13, 0.19, 36);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd6d8, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      parent.add(m);
      this.items.push({ mesh: m, life: 0 });
    }
    this.cursor = 0;
  }

  fire(x, y) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    it.mesh.position.set(x, y, FACE_Z + 0.18);
    it.mesh.visible = true;
    it.life = 1;
  }

  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt * 3.2;
      const k = 1 - Math.max(0, it.life);
      const s = 0.5 + k * 2.4;
      it.mesh.scale.set(s, s, s);
      it.mesh.material.opacity = Math.max(0, it.life) * 0.65;
      if (it.life <= 0) it.mesh.visible = false;
    }
  }
}
