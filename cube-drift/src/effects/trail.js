// effects/trail.js
// A glowing ribbon that streams behind the cube. Built from a short history of
// positions; additive blending means fading a vertex toward black fades it out.
// Widens & brightens while drifting and at high speed.

import * as THREE from 'three';

const N = 46;                     // ribbon resolution (history length)

export class Trail {
  constructor(scene) {
    this.pts = [];                // {p:Vector3, dir:Vector3}
    this.positions = new Float32Array(N * 2 * 3);
    this.colors = new Float32Array(N * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const index = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      index.push(a, b, c, b, d, c);
    }
    geo.setIndex(index);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.geo = geo;
    scene.add(this.mesh);

    this.base = new THREE.Color(0x18f0ff);
    this.driftColor = new THREE.Color(0xff2bd6);
    this._c = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
    this._perp = new THREE.Vector3();
    this.width = 0.18;
  }

  reset() { this.pts.length = 0; }

  /** @param drift01 0..1   @param speed01 0..1 */
  push(pos, heading, drift01, speed01) {
    this.pts.unshift({ p: pos.clone().setY(pos.y + 0.05), dir: heading.clone() });
    if (this.pts.length > N) this.pts.pop();

    const targetW = 0.16 + drift01 * 0.42 + speed01 * 0.18;
    this.width += (targetW - this.width) * 0.3;
    this._c.copy(this.base).lerp(this.driftColor, drift01);
    const headBoost = 1 + drift01 * 1.4 + speed01 * 0.6;

    const n = this.pts.length;
    for (let i = 0; i < N; i++) {
      const src = this.pts[Math.min(i, n - 1)];
      const fade = 1 - i / N;
      const w = this.width * (0.25 + fade * 0.95);
      this._perp.crossVectors(this._up, src.dir).normalize().multiplyScalar(w);
      const li = i * 6;
      // two ribbon edges
      this.positions[li]     = src.p.x - this._perp.x;
      this.positions[li + 1] = src.p.y;
      this.positions[li + 2] = src.p.z - this._perp.z;
      this.positions[li + 3] = src.p.x + this._perp.x;
      this.positions[li + 4] = src.p.y;
      this.positions[li + 5] = src.p.z + this._perp.z;
      const k = fade * fade * headBoost;
      const r = this._c.r * k, g = this._c.g * k, b = this._c.b * k;
      this.colors[li] = r; this.colors[li + 1] = g; this.colors[li + 2] = b;
      this.colors[li + 3] = r; this.colors[li + 4] = g; this.colors[li + 5] = b;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }
}
