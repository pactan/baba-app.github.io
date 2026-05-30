import * as THREE from 'three';
import { Station } from './base.js';
import { Spring } from '../spring.js';
import { Stage } from '../stage.js';
import { M, lathe } from '../util.js';

// 06 — Squish. A translucent gel blob on a turned dish. Pressing dimples the
// surface at the exact contact point with a gaussian falloff (real local
// deformation, not uniform scale); holding deepens it and raises a subsurface
// glow. Release => an under-damped depth spring overshoots past zero and a
// secondary volume-preserving squash wobble settles out, with a 'boing'. A
// squish noiseTone plays while pressing (pitch ∝ pressure). Once both springs
// are at rest the per-frame vertex rebuild is skipped (one final clean restore).
const R = 0.92;
const FALLOFF = 0.62;
const CY = 1.0;            // blob center height

export class SquishStation extends Station {
  get title() { return 'Squish'; }
  get index() { return '06'; }
  frame() { return { y: 1.0, halfW: 1.3, halfH: 1.3 }; }

  build() {
    // Translucent jelly: transmission + clearcoat + sheen, animatable emissive.
    this.mat = M.glass(0x7fd1c9, {
      roughness: 0.16, transmission: 0.72, thickness: 1.3, ior: 1.36,
      clearcoat: 0.6, clearcoatRoughness: 0.18,
      sheen: 0.6, sheenColor: new THREE.Color(0xbfffe8),
      emissive: new THREE.Color(0x0e3b36), emissiveIntensity: 0.05,
    });

    this.geo = new THREE.SphereGeometry(R, 56, 40);
    this.base = this.geo.attributes.position.array.slice();
    this.blob = new THREE.Mesh(this.geo, this.mat);
    this.blob.position.set(0, CY, 0);
    this.blob.castShadow = true;
    this.group.add(this.blob);

    // A faint inner core that brightens with pressure, sells the gel volume.
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x0a0c10, emissive: new THREE.Color(0x37d6c4), emissiveIntensity: 0.0,
      roughness: 0.5, transparent: true, opacity: 0.55,
    });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(R * 0.46, 28, 20), coreMat);
    this.core.position.set(0, CY, 0);
    this.coreMat = coreMat;
    this.group.add(this.core);

    // --- turned dish / base it rests in ---
    const dishMat = M.alu(0xb9bec6);
    const dish = lathe([
      [0.0, 0.0], [0.86, 0.0], [0.9, 0.05], [0.86, 0.12],
      [0.66, 0.2], [0.6, 0.28], [0.6, 0.3], [0.62, 0.34], [0.0, 0.34],
    ], dishMat, 64);
    dish.castShadow = dish.receiveShadow = true;
    this.group.add(dish);
    // a dark rubber pad inside the dish the blob sits on
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.58, 0.58, 0.06, 48), M.rubber(0x1a1d22));
    pad.position.y = 0.33;
    pad.receiveShadow = true;
    this.group.add(pad);

    this.interactive = [this.blob];
    this.group.add(Stage.contactShadow(1.15, 0.5));

    this.center = new THREE.Vector3(0, 0, R);  // local dimple center on the surface
    this.depth = new Spring(120, 11, 0);        // under-damped => jiggle on release
    this.squash = new Spring(90, 7, 1);          // vertical scale wobble
    this.pressing = false;
    this.pressure = 0;
    this._dirty = false;
    this.squishSnd = null;
  }

  _setCenter(hit) {
    this.center.copy(this.blob.worldToLocal(hit.point.clone()))
      .normalize().multiplyScalar(R);
  }

  onDown(hit) {
    if (!hit) return;
    this.pressing = true;
    this.pressure = 0;
    this._setCenter(hit);
    if (!this.squishSnd) this.squishSnd = this.ctx.feedback.sound.noiseTone({ freq: 500, q: 1.0, gain: 0 });
    this.ctx.feedback.emit({ type: 'pop-out', intensity: 0.4, pitch: 1.3 });
  }

  onMove(hit) {
    if (this.pressing && hit) this._setCenter(hit);
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

  onLeave() {
    if (this.squishSnd) { this.squishSnd.setGain(0); this.squishSnd.stop(); this.squishSnd = null; }
    this.pressing = false;
  }

  update(dt) {
    if (this.pressing) {
      this.pressure = Math.min(1.4, this.pressure + dt * 0.8);
      this.depth.set(0.32 + 0.22 * this.pressure);
      this.squash.set(1 - 0.12 * Math.min(1, this.pressure));
      if (this.squishSnd) {
        this.squishSnd.setGain(0.06 + 0.06 * Math.min(1, this.pressure));
        this.squishSnd.setFreq(450 + this.pressure * 500);
      }
    }

    if (this.ctx.settings.reducedMotion && !this.pressing) {
      this.depth.snap(0); this.squash.snap(1);
    }

    const depth = this.depth.update(dt);
    const sy = this.squash.update(dt);

    // Skip the expensive vertex+normal rebuild once everything has settled,
    // doing exactly one final clean restore pass.
    const active = this.pressing || !this.depth.atRest || !this.squash.atRest;
    if (!active && !this._dirty) {
      this.mat.emissiveIntensity += (0.05 - this.mat.emissiveIntensity) * Math.min(1, dt * 6);
      this.coreMat.emissiveIntensity += (0.0 - this.coreMat.emissiveIntensity) * Math.min(1, dt * 6);
      return;
    }
    this._dirty = active;

    // Rebuild the surface: push vertices near the dimple inward (gaussian).
    const pos = this.geo.attributes.position.array;
    const b = this.base;
    const cx = this.center.x, cy = this.center.y, cz = this.center.z;
    const inv2 = 1 / (FALLOFF * FALLOFF);
    const invR = 1 / R;
    for (let i = 0; i < pos.length; i += 3) {
      const x = b[i], y = b[i + 1], z = b[i + 2];
      const dx = x - cx, dy = y - cy, dz = z - cz;
      const f = Math.exp(-(dx * dx + dy * dy + dz * dz) * inv2) * depth;
      pos[i] = x - x * invR * f;
      pos[i + 1] = y - y * invR * f;
      pos[i + 2] = z - z * invR * f;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();

    // Volume-preserving squash + subsurface glow under pressure.
    const syc = Math.max(0.2, sy);
    const sxz = 1 / Math.sqrt(syc);
    this.blob.scale.set(sxz, syc, sxz);
    this.core.scale.set(sxz, syc, sxz);
    const glow = 0.05 + Math.max(0, depth) * 1.1;
    this.mat.emissiveIntensity = glow;
    this.coreMat.emissiveIntensity = Math.max(0, depth) * 1.6;
  }

  info() {
    const pct = Math.round(Math.min(1, Math.max(0, this.depth.value) / 0.55) * 100);
    return `<span class="num">${pct}</span>%`;
  }
}
