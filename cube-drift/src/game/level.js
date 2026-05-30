// game/level.js
// Procedural, infinite neon "zig-zag" of suspended platforms.
//
// The path always alternates between heading +X and +Z, building a diagonal
// staircase. Each straight stretch ("run") is a number of tiles; the player has
// to tap to turn at every corner or they slide off into the void.
//
// Rendering: every platform tile is an instance in one of two InstancedMeshes
// (cyan / magenta) -> the entire endless world costs ~2 draw calls. Tiles and
// physics colliders are pooled and recycled as the cube moves forward.

import * as THREE from 'three';

export const TILE = 2.6;      // distance between tile centres along a run
export const PW = 2.2;        // platform cross-width
const THICK = 0.5;            // platform thickness (top surface sits at y = 0)
const CAP = 420;              // instance capacity per colour mesh
const ORB_CAP = 40;

export const DIRS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 0, 1),
];

function tileTexture() {
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d');
  x.fillStyle = '#060417';
  x.fillRect(0, 0, s, s);
  // bright neon frame -> blooms into a glowing edge
  const b = 12;
  const g = x.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#cfefff');
  x.strokeStyle = g;
  x.lineWidth = b;
  x.strokeRect(b / 2, b / 2, s - b, s - b);
  x.globalAlpha = 0.25;
  x.strokeStyle = '#ffffff';
  x.lineWidth = 2;
  x.strokeRect(s * 0.28, s * 0.28, s * 0.44, s * 0.44);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

class TilePool {
  constructor(color, tex) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0a0820,
      emissive: new THREE.Color(color),
      emissiveMap: tex,
      emissiveIntensity: 2.4,
      metalness: 0.2,
      roughness: 0.6,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = CAP;
    this.mesh.frustumCulled = false;
    this.free = [];
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = CAP - 1; i >= 0; i--) { this.mesh.setMatrixAt(i, hidden); this.free.push(i); }
    this.mesh.instanceMatrix.needsUpdate = true;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._hidden = hidden;
  }
  alloc(cx, cz, sx, sz) {
    if (!this.free.length) return -1;
    const i = this.free.pop();
    this._p.set(cx, -THICK / 2, cz);
    this._s.set(sx, THICK, sz);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(i, this._m);
    this.mesh.instanceMatrix.needsUpdate = true;
    return i;
  }
  release(i) {
    if (i < 0) return;
    this.mesh.setMatrixAt(i, this._hidden);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.free.push(i);
  }
}

export class Level {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    const tex = tileTexture();
    this.pools = [new TilePool(0x18f0ff, tex), new TilePool(0xff2bd6, tex)];
    scene.add(this.pools[0].mesh, this.pools[1].mesh);

    // Collectible shards.
    const orbGeo = new THREE.IcosahedronGeometry(0.34, 0);
    const orbMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xfff2a0, emissiveIntensity: 3.2,
      metalness: 0.4, roughness: 0.25,
    });
    this.orbMesh = new THREE.InstancedMesh(orbGeo, orbMat, ORB_CAP);
    this.orbMesh.frustumCulled = false;
    this.orbMesh.count = ORB_CAP;
    this.orbs = [];               // {x,z, idx, alive}
    this._orbFree = [];
    for (let i = ORB_CAP - 1; i >= 0; i--) this._orbFree.push(i);
    this._hideOrb(0, ORB_CAP);
    scene.add(this.orbMesh);

    this.runs = [];               // {tileIdx:[{pool,i}], body, color}
    this._om = new THREE.Matrix4();
    this._oq = new THREE.Quaternion();
    this._op = new THREE.Vector3();
    this._os = new THREE.Vector3(1, 1, 1);
  }

  _hideOrb(from, to) {
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = from; i < to; i++) this.orbMesh.setMatrixAt(i, hidden);
    this.orbMesh.instanceMatrix.needsUpdate = true;
  }

  reset() {
    for (const r of this.runs) this._disposeRun(r);
    this.runs.length = 0;
    for (const o of this.orbs) if (o.idx >= 0) { this._releaseOrb(o); }
    this.orbs.length = 0;

    this.cx = 0; this.cz = 0;     // current corner (world units)
    this.dir = 0;                 // current DIRS index
    this.runCount = 0;
    // generous starting runway so the player eases in
    this._emitRun(6, true);
  }

  _disposeRun(r) {
    for (const t of r.tileIdx) this.pools[t.pool].release(t.i);
    if (r.body) this.physics.remove(r.body);
  }

  /** Emit one straight run of L tiles in the current direction. */
  _emitRun(L, first) {
    const d = DIRS[this.dir];
    const color = this.runCount % 2;
    const pool = this.pools[color];
    const tiles = [];

    const startK = first ? 0 : 1;          // skip the shared corner tile otherwise
    for (let k = startK; k <= L; k++) {
      const x = this.cx + d.x * (k * TILE);
      const z = this.cz + d.z * (k * TILE);
      // X-runs span TILE along x, PW along z; Z-runs the opposite.
      const sx = d.x ? TILE * 0.97 : PW;
      const sz = d.z ? TILE * 0.97 : PW;
      const i = pool.alloc(x, z, sx, sz);
      if (i >= 0) tiles.push({ pool: color, i });

      // sprinkle shards along straight stretches
      if (!first && k > 0 && k < L && (k % 2 === 0) && Math.random() < 0.5) {
        this._spawnOrb(x, z);
      }
    }

    // One collider for the whole run, padded by half a tile each end so the
    // corners always overlap their neighbours (no gap to fall through).
    const cxr = this.cx + d.x * (L * TILE / 2);
    const czr = this.cz + d.z * (L * TILE / 2);
    const halfLen = (L * TILE + TILE) / 2;
    const hx = d.x ? halfLen : PW / 2;
    const hz = d.z ? halfLen : PW / 2;
    const body = this.physics.addPlatform(cxr, -THICK / 2, czr, hx, THICK / 2, hz);

    this.runs.push({ tileIdx: tiles, body, color });

    // advance corner to the end of this run, then turn 90°.
    this.cx += d.x * (L * TILE);
    this.cz += d.z * (L * TILE);
    this.dir ^= 1;
    this.runCount++;
  }

  _spawnOrb(x, z) {
    if (!this._orbFree.length) return;
    const idx = this._orbFree.pop();
    const o = { x, z, idx, alive: true, phase: Math.random() * 6.28 };
    this.orbs.push(o);
    this._setOrb(o, 0);
  }
  _setOrb(o, t) {
    this._op.set(o.x, 1.3 + Math.sin(t * 2 + o.phase) * 0.18, o.z);
    this._oq.setFromAxisAngle(_UP, t * 1.6 + o.phase);
    this._om.compose(this._op, this._oq, this._os);
    this.orbMesh.setMatrixAt(o.idx, this._om);
    this.orbMesh.instanceMatrix.needsUpdate = true;
  }
  _releaseOrb(o) {
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    this.orbMesh.setMatrixAt(o.idx, hidden);
    this.orbMesh.instanceMatrix.needsUpdate = true;
    this._orbFree.push(o.idx);
    o.idx = -1; o.alive = false;
  }

  /** Make sure the path extends at least `ahead` units beyond the cube. */
  ensureAhead(cubePos, ahead, difficulty) {
    // distance from cube to the current corner along the diagonal
    let guard = 0;
    while (this._cornerDist(cubePos) < ahead && guard++ < 24) {
      // easy = long runs, hard = short, twitchy runs
      const maxRun = Math.max(1, Math.round(6 - difficulty * 4.5));
      const minRun = Math.max(1, Math.round(3 - difficulty * 2.5));
      const L = minRun + Math.floor(Math.random() * (maxRun - minRun + 1));
      this._emitRun(L, false);
    }
  }

  _cornerDist(p) {
    const dx = this.cx - p.x, dz = this.cz - p.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /** Recycle runs whose far end is well behind the cube. */
  recycle(cubePos) {
    while (this.runs.length > 10) {
      const r = this.runs[0];
      // a run is behind us once its centre is well past the cube on both axes
      const t = r.body.translation();
      if (t.x < cubePos.x - 14 && t.z < cubePos.z - 14) {
        this._disposeRun(r);
        this.runs.shift();
      } else break;
    }
  }

  /** Detect & collect shards near the cube. Returns count collected. */
  collect(cubePos, radius, onCollect) {
    let n = 0;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      if (!o.alive) { this.orbs.splice(i, 1); continue; }
      const dx = o.x - cubePos.x, dz = o.z - cubePos.z, dy = 1.3 - cubePos.y;
      if (dx * dx + dz * dz + dy * dy < radius * radius) {
        onCollect(o.x, 1.3, o.z);
        this._releaseOrb(o);
        this.orbs.splice(i, 1);
        n++;
      }
    }
    return n;
  }

  update(t) {
    for (const o of this.orbs) if (o.alive) this._setOrb(o, t);
  }
}

const _UP = new THREE.Vector3(0, 1, 0);
