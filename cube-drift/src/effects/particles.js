// effects/particles.js
// One pooled THREE.Points system for everything spark-like: drift sparks,
// shard pickups and the wipeout burst. Additive + per-point colour fade.

import * as THREE from 'three';

const MAX = 320;

function sparkTexture() {
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

export class Particles {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.vel = new Array(MAX);
    this.life = new Float32Array(MAX);
    this.max = new Float32Array(MAX);
    this.base = new Array(MAX);
    for (let i = 0; i < MAX; i++) { this.vel[i] = new THREE.Vector3(); this.base[i] = new THREE.Color(); this.pos[i * 3 + 1] = -999; }
    this.head = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.35, map: sparkTexture(), vertexColors: true,
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.geo = geo;
    scene.add(this.points);
    this._tmp = new THREE.Color();
  }

  _emit(x, y, z, vx, vy, vz, color, life) {
    const i = this.head; this.head = (this.head + 1) % MAX;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i].set(vx, vy, vz);
    this.base[i].copy(color);
    this.life[i] = life; this.max[i] = life;
  }

  driftSparks(pos, heading, intensity) {
    const n = 1 + (Math.random() < intensity ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const spread = 0.7;
      this._tmp.setHSL(0.5 + Math.random() * 0.35, 1, 0.6);
      this._emit(
        pos.x + (Math.random() - 0.5) * 0.4, pos.y - 0.2, pos.z + (Math.random() - 0.5) * 0.4,
        -heading.x * 2 + (Math.random() - 0.5) * spread,
        1.5 + Math.random() * 1.5,
        -heading.z * 2 + (Math.random() - 0.5) * spread,
        this._tmp, 0.45 + Math.random() * 0.3);
    }
  }

  burst(x, y, z, n, color, power = 6) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI;
      const sp = power * (0.4 + Math.random() * 0.8);
      this._emit(x, y, z,
        Math.cos(a) * Math.cos(b) * sp,
        Math.abs(Math.sin(b)) * sp + 1,
        Math.sin(a) * Math.cos(b) * sp,
        color, 0.6 + Math.random() * 0.5);
    }
  }

  update(dt) {
    let dirty = false;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      dirty = true;
      this.life[i] -= dt;
      const v = this.vel[i];
      v.y -= 9 * dt;
      this.pos[i * 3] += v.x * dt;
      this.pos[i * 3 + 1] += v.y * dt;
      this.pos[i * 3 + 2] += v.z * dt;
      const f = Math.max(0, this.life[i] / this.max[i]);
      const c = this.base[i];
      this.col[i * 3] = c.r * f; this.col[i * 3 + 1] = c.g * f; this.col[i * 3 + 2] = c.b * f;
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -999;
    }
    if (dirty) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
  }

  reset() {
    for (let i = 0; i < MAX; i++) { this.life[i] = 0; this.pos[i * 3 + 1] = -999; }
    this.geo.attributes.position.needsUpdate = true;
  }
}
