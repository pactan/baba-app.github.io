import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ============================================================================
// Modeling toolkit — shared materials, procedural textures and geometry
// builders so every fidget is built to a consistent, physically-based,
// "studio product render" standard. All material functions return FRESH
// instances (stations sometimes mutate emissiveIntensity etc, so never share).
// ============================================================================

// ---- rounded slab ---------------------------------------------------------
export function rbox(w, h, d, r = 0.06, seg = 4) {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) / 2 - 1e-3));
}

// ---- procedural textures --------------------------------------------------
const _texCache = {};

// Fine brushed-metal roughness streaks (anisotropic look). Cached by key.
export function brushedRoughness() {
  if (_texCache.brushed) return _texCache.brushed.clone();
  const s = 512;
  const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 2600; i++) {
    const y = Math.random() * s, len = 30 + Math.random() * 180, x = Math.random() * s;
    const v = 120 + Math.random() * 110;
    g.strokeStyle = `rgba(${v},${v},${v},0.10)`;
    g.lineWidth = Math.random() < 0.5 ? 1 : 2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y); g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  _texCache.brushed = tex;
  return tex.clone();
}

// Diagonal cross-hatch knurling, usable as a bump map.
export function knurlBump(repeat = 8) {
  if (!_texCache.knurl) {
    const s = 256;
    const cv = document.createElement('canvas'); cv.width = cv.height = s;
    const g = cv.getContext('2d');
    g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#ffffff'; g.lineWidth = 2;
    for (let i = -s; i < s; i += 10) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + s, s); g.stroke();
    }
    g.strokeStyle = '#202020';
    for (let i = -s; i < s; i += 10) {
      g.beginPath(); g.moveTo(i + s, 0); g.lineTo(i, s); g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    _texCache.knurl = tex;
  }
  const t = _texCache.knurl.clone();
  t.repeat.set(repeat, repeat);
  return t;
}

// ---- material library -----------------------------------------------------
export const M = {
  // Brushed/anodized aluminium — the Apple-grey workhorse.
  alu(color = 0xc9ced6) {
    const m = new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: 0.38, envMapIntensity: 1.1 });
    const r = brushedRoughness(); r.repeat.set(3, 3); m.roughnessMap = r;
    return m;
  },
  polishedSteel() {
    return new THREE.MeshPhysicalMaterial({ color: 0xdfe4ea, metalness: 1, roughness: 0.12, envMapIntensity: 1.3 });
  },
  darkMetal(color = 0x34383f) {
    return new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: 0.42, envMapIntensity: 1.0 });
  },
  brass() {
    return new THREE.MeshPhysicalMaterial({ color: 0xd6a44c, metalness: 1, roughness: 0.32, envMapIntensity: 1.1 });
  },
  // Satin injection-moulded plastic with a subtle clearcoat.
  plastic(color = 0xf2f3f5, extra = {}) {
    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.35, envMapIntensity: 0.9, ...extra });
  },
  // Matte soft-touch silicone / rubber.
  soft(color = 0xe7484f, extra = {}) {
    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.62, sheen: 0.6, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.4), clearcoat: 0.25, ...extra });
  },
  rubber(color = 0x1b1e24) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
  },
  // Translucent gel / glass.
  glass(color = 0x9fe8df, extra = {}) {
    return new THREE.MeshPhysicalMaterial({ color, roughness: 0.12, transmission: 0.7, thickness: 1.0, ior: 1.4, clearcoat: 0.5, transparent: true, ...extra });
  },
  // Emissive indicator. emissiveIntensity is meant to be animated per-instance.
  led(color = 0x0a84ff, intensity = 1) {
    return new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: color, emissiveIntensity: intensity, roughness: 0.3 });
  },
};

// ---- geometry builders ----------------------------------------------------

// Revolve a 2D profile (array of [x,y]) around the Y axis — for turned metal
// parts (knobs, bezels, spool, screw heads, bearings…).
export function lathe(points, mat, segments = 64) {
  const pts = points.map((p) => new THREE.Vector2(p[0], p[1]));
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

// A hex bolt: hex head + cylindrical shaft (+ chamfer). Axis along +Y by
// default; rotate the returned group to orient it.
export function hexBolt(headR = 0.38, headH = 0.34, shaftR = 0.2, shaftLen = 0.8, mat) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.CylinderGeometry(headR, headR, headH, 6), mat);
  head.castShadow = true; g.add(head);
  const cham = new THREE.Mesh(new THREE.CylinderGeometry(headR * 0.82, headR, headH * 0.25, 6), mat);
  cham.position.y = -headH * 0.5; g.add(cham);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftR, shaftR, shaftLen, 24), mat);
  shaft.position.y = -headH / 2 - shaftLen / 2; shaft.castShadow = true; g.add(shaft);
  g.userData.head = head;
  return g;
}

// A small slotted screw head (for visual fasteners).
export function screwHead(r = 0.08, mat) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.CylinderGeometry(r, r, r * 0.4, 20), mat);
  head.rotation.x = Math.PI / 2; g.add(head);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(r * 1.8, r * 0.18, r * 0.5),
    new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.7 }));
  slot.position.z = r * 0.2; g.add(slot);
  return g;
}

// Apply a knurl bump map to a material in place (returns the same material).
export function knurled(mat, repeat = 8, scale = 0.004) {
  mat.bumpMap = knurlBump(repeat);
  mat.bumpScale = scale;
  return mat;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
