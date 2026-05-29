import * as THREE from 'three';
import { Station } from './base.js';
import { Spring } from '../spring.js';
import { Stage } from '../stage.js';

// 06 — Squish. A soft jelly blob. The touch point dimples in with a falloff
// (real contact-point deformation, not uniform scale); holding deepens it.
// Release => squash-stretch jiggle with a secondary wobble. Translucent gel.
const R = 0.95;
const FALLOFF = 0.7;

export class SquishStation extends Station {
  get title() { return 'Squish'; }
  get index() { return '06'; }

  build() {
    this.mat = new THREE.MeshPhysicalMaterial({
      color: 0x7fd1c9, roughness: 0.25, transmission: 0.55, thickness: 1.2,
      ior: 1.35, clearcoat: 0.4, sheen: 0.5, sheenColor: 0xbfffe8,
      emissive: 0x0e3b36, emissiveIntensity: 0.0,
    });

    this.geo = new THREE.SphereGeometry(R, 56, 40);
    this.base = this.geo.attributes.position.array.slice();
    this.blob = new THREE.Mesh(this.geo, this.mat);
    this.blob.position.set(0, 1.0, 0);
    this.blob.castShadow = true;
    this.group.add(this.blob);

    // Pedestal so it reads as resting on something.
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 0.18, 48),
      new THREE.MeshPhysicalMaterial({ color: 0x2a2d34, roughness: 0.6 }));
    dish.position.y = 0.09; dish.receiveShadow = true;
    this.group.add(dish);

    this.interactive = [this.blob];
    this.group.add(Stage.contactShadow(1.2, 0.5));

    this.center = new THREE.Vector3(0, 0, R);  // local dimple center
    this.depth = new Spring(120, 11, 0);        // underdamped => jiggle
    this.squash = new Spring(90, 7, 1);          // vertical scale wobble
    this.pressing = false;
    this.pressure = 0;
    this.squishSnd = null;
  }

  onDown(hit) {
    if (!hit) return;
    this.pressing = true;
    this.pressure = 0;
    this.center.copy(this.blob.worldToLocal(hit.point.clone())).normalize().multiplyScalar(R);
    if (!this.squishSnd) this.squishSnd = this.ctx.feedback.sound.noiseTone({ freq: 500, q: 1.0, gain: 0 });
    this.ctx.feedback.emit({ type: 'pop-out', intensity: 0.4, pitch: 1.3 });
  }

  onMove(hit) {
    if (this.pressing && hit) {
      this.center.copy(this.blob.worldToLocal(hit.point.clone())).normalize().multiplyScalar(R);
    }
  }

  onUp() {
    if (!this.pressing) return;
    this.pressing = false;
    const amt = 0.4 + 0.6 * Math.min(1, this.pressure);
    this.depth.set(0); this.depth.v = -8 * amt;     // bounce back past zero
    this.squash.set(1); this.squash.v = 5 * amt;     // stretch up then settle
    this.ctx.feedback.emit({ type: 'boing', intensity: amt, pitch: 1.3 - 0.4 * amt });
    if (this.squishSnd) this.squishSnd.setGain(0);
  }

  update(dt) {
    if (this.pressing) {
      this.pressure = Math.min(1.4, this.pressure + dt * 0.8);
      this.depth.set(0.32 + 0.22 * this.pressure);
      this.squash.set(1 - 0.12 * Math.min(1, this.pressure));
      if (this.squishSnd) this.squishSnd.setGain(0.06 + 0.06 * Math.min(1, this.pressure));
      if (this.squishSnd) this.squishSnd.setFreq(450 + this.pressure * 500);
    }
    const depth = this.depth.update(dt);
    const sy = this.squash.update(dt);

    // Rebuild the surface: push vertices near the dimple inward with a gaussian falloff.
    const pos = this.geo.attributes.position.array;
    const b = this.base;
    const cx = this.center.x, cy = this.center.y, cz = this.center.z;
    const inv2 = 1 / (FALLOFF * FALLOFF);
    for (let i = 0; i < pos.length; i += 3) {
      const x = b[i], y = b[i + 1], z = b[i + 2];
      const dx = x - cx, dy = y - cy, dz = z - cz;
      const f = Math.exp(-(dx * dx + dy * dy + dz * dz) * inv2) * depth;
      const inv = 1 / R;
      pos[i] = x - x * inv * f;
      pos[i + 1] = y - y * inv * f;
      pos[i + 2] = z - z * inv * f;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();

    // Volume-preserving squash + subsurface glow under pressure.
    this.blob.scale.set(1 / Math.sqrt(Math.max(0.2, sy)), Math.max(0.2, sy), 1 / Math.sqrt(Math.max(0.2, sy)));
    this.mat.emissiveIntensity = 0.05 + Math.max(0, depth) * 1.1;
  }

  info() { return `squish`; }
}
