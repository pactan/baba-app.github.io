import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Rounded slab — soft edges read far more "premium/physical" than hard boxes.
export function rbox(w, h, d, r = 0.06, seg = 4) {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) / 2 - 1e-3));
}

// Shared white-plastic look so every toy's body matches.
export function plastic(color = 0xf2f3f5, extra = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.35, ...extra });
}
