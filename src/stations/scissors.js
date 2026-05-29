import * as THREE from 'three';
import { Station } from './base.js';
import { Spring } from '../spring.js';
import { Stage } from '../stage.js';

// 12 — Scissors (new). A pair of scissors over a ribbon that feeds from a spool.
// Grab the ribbon and PULL it forward/around (it's a real Verlet rope: gravity,
// sway, drag). Squeeze the handles to close the blades; when they cross the
// ribbon it CUTS — the piece below detaches and falls/tumbles on its own, and
// the spool feeds fresh ribbon back down so you can do it again.
const CUT_Y = 1.25;
const SEG = 0.12;
const FULL = 16;     // resting node count (hangs to just below the blades)
const MAX = 40;      // max when pulled out
const PULL_Z = 0.45; // depth the ribbon is pulled to (in front of the blades)
const A = 0.24;      // blade open angle

const _d = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _Z = new THREE.Vector3(0, 0, 1);

export class ScissorsStation extends Station {
  get title() { return 'Scissors'; }
  get index() { return '12'; }
  frame() { return { y: 1.25, halfW: 1.5, halfH: 1.65 }; }

  build() {
    this.cuts = this.load('scissors.cuts', 0);
    this.spool = new THREE.Vector3(0, 2.5, 0);

    const steel = new THREE.MeshPhysicalMaterial({ color: 0xc9ced6, roughness: 0.25, metalness: 1 });
    const grip = new THREE.MeshPhysicalMaterial({ color: 0xff5a7a, roughness: 0.45, clearcoat: 0.4 });

    // Spool at the top.
    const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 28), steel);
    spool.rotation.z = Math.PI / 2; spool.position.copy(this.spool); spool.castShadow = true;
    this.group.add(spool);

    // Two rigid arms (blade up + handle/loop down) pivoting at the screw.
    this.arms = [];
    for (const s of [1, -1]) {
      const arm = new THREE.Group();
      arm.position.set(0, CUT_Y, 0);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.0, 0.05), steel);
      bar.position.set(0, 0.1, s * 0.03);   // offset in z so the two blades pass
      bar.castShadow = true;
      // tapered blade tip
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 4), steel);
      tip.position.set(0, 1.3, s * 0.03); tip.castShadow = true;
      // handle loop at the bottom
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 12, 28), grip);
      loop.position.set(s * 0.0, -1.05, s * 0.03);
      loop.userData.role = 'handle';
      arm.add(bar, tip, loop);
      this.group.add(arm);
      this.arms.push({ group: arm, sign: s, loop });
    }
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.14, 20), steel);
    screw.rotation.x = Math.PI / 2; screw.position.set(0, CUT_Y, 0);
    this.group.add(screw);

    // Main ribbon (Verlet rope) + its mesh.
    this.ribbonColor = 0xffd54a;
    this.main = new Rope(MAX, SEG);
    this.main.init(FULL, this.spool);
    this.mainMesh = new RibbonMesh(MAX, this.ribbonColor, this.group);

    // A pool of falling cut pieces.
    this.pieces = [];
    for (let i = 0; i < 4; i++) {
      this.pieces.push({ rope: new Rope(MAX, SEG), mesh: new RibbonMesh(MAX, this.ribbonColor, this.group, true), life: 0 });
    }

    // Interaction volumes.
    // Narrow so it doesn't sit in front of the splayed handle loops (which must
    // stay tappable to operate the blades).
    const column = new THREE.Mesh(new THREE.BoxGeometry(0.34, 2.6, 0.4), new THREE.MeshBasicMaterial({ visible: false }));
    column.position.set(0, 1.3, 0.05); column.userData.role = 'ribbon';
    this.group.add(column);
    this.interactive = [column, this.arms[0].loop, this.arms[1].loop];

    this.group.add(Stage.contactShadow(1.4, 0.4));

    this.close = new Spring(220, 22, 0);
    this.pull = { active: false, idx: 0, target: new THREE.Vector3() };
    this.scissorDrag = false;
    this.cutLatch = false;
    this.prevClose = 0;
    this.feedT = 0;
  }

  onDown(hit, ndc) {
    const role = hit?.object.userData.role;
    if (role === 'handle') {
      this.scissorDrag = true;
      this.scStart = ndc.clone();
      this.scMoved = false;
    } else if (role === 'ribbon') {
      this.pull.active = true;
      this.pull.idx = this.main.count - 1;
      this.pull.target.copy(this.ctx.rayToZ(ndc, PULL_Z));
    }
  }

  onMove(hit, ndc) {
    if (this.scissorDrag) {
      const dx = ndc.x - this.scStart.x, dy = ndc.y - this.scStart.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.02) this.scMoved = true;
      this.close.set(Math.max(0, Math.min(1, dist * 3.2)));
    } else if (this.pull.active) {
      this.pull.target.copy(this.ctx.rayToZ(ndc, PULL_Z));
    }
  }

  onUp() {
    if (this.scissorDrag && !this.scMoved) {
      // Tap = auto-snip.
      this.close.set(1);
      setTimeout(() => this.close.set(0), 150);
    } else {
      this.close.set(0);
    }
    this.scissorDrag = false;
    this.pull.active = false;
  }

  onLeave() {
    this.scissorDrag = false;
    this.pull.active = false;
    this.close.snap(0);
  }

  update(dt) {
    dt = Math.min(dt, 1 / 30);
    const c = this.close.update(dt);

    // Blades open/close.
    this.arms[0].group.rotation.z = A * (1 - c);
    this.arms[1].group.rotation.z = -A * (1 - c);

    // A light metallic tick as the blades sweep closed.
    if (this.prevClose < 0.5 && c >= 0.5) this.ctx.feedback.emit({ type: 'blade', intensity: 0.4 });

    // Cut fires once per close, when the blades cross the ribbon.
    if (c >= 0.82 && !this.cutLatch) { this.cutLatch = true; this._cut(); }
    if (c < 0.4) this.cutLatch = false;
    this.prevClose = c;

    // --- main rope ---
    for (let i = 0; i < this.main.count; i++) this.main.nodes[i].pinned = false;
    this.main.nodes[0].pinned = true;
    this.main.nodes[0].p.copy(this.spool);
    this.main.nodes[0].q.copy(this.spool);
    if (this.pull.active) {
      this.pull.idx = Math.min(this.pull.idx, this.main.count - 1);
      const b = this.main.nodes[this.pull.idx];
      b.pinned = true; b.p.copy(this.pull.target); b.q.copy(this.pull.target);
      // Pulling while taut feeds fresh ribbon from the spool.
      const span = this.main.nodes[0].p.distanceTo(b.p);
      if (this.main.count < MAX && span > (this.main.count - 1) * SEG * 0.98) {
        this._feed();
        this.pull.idx = this.main.count - 1;
      }
    } else if (this.main.count < FULL) {
      // Spool pays ribbon back out after a cut.
      this.feedT += dt;
      if (this.feedT > 0.04) { this.feedT = 0; this._feed(); }
    }
    this.main.update(dt);
    this.mainMesh.update(this.main.nodes, this.main.count);

    // --- falling pieces ---
    for (const pc of this.pieces) {
      if (pc.life <= 0) continue;
      pc.life -= dt;
      pc.rope.update(dt);
      pc.mesh.update(pc.rope.nodes, pc.rope.count);
      pc.mesh.mat.opacity = Math.max(0, Math.min(1, pc.life));
      if (pc.life <= 0) pc.mesh.mesh.visible = false;
    }
  }

  _feed() {
    const i = this.main.count;
    if (i >= MAX) return;
    const prev = this.main.nodes[i - 1];
    const n = this.main.nodes[i];
    n.p.copy(prev.p); n.p.y -= SEG; n.q.copy(n.p); n.pinned = false;
    this.main.count++;
  }

  _cut() {
    // Sever at the rope node nearest the cut line that sits in the blades.
    let bi = -1, best = 0.4;
    for (let i = 2; i < this.main.count; i++) {
      const n = this.main.nodes[i];
      const d = Math.abs(n.p.y - CUT_Y);
      if (Math.abs(n.p.x) < 0.4 && d < best) { best = d; bi = i; }
    }
    if (bi < 2) return;

    const piece = this._getPiece();
    const count = this.main.count - bi;
    piece.rope.count = count;
    for (let j = 0; j < count; j++) {
      const src = this.main.nodes[bi + j];
      const pn = piece.rope.nodes[j];
      pn.p.copy(src.p);
      pn.q.copy(src.p);
      pn.q.x -= 0.04 + Math.random() * 0.03; // a little kick from the blades
      pn.q.z -= 0.02;
      pn.pinned = false;
    }
    piece.life = 4;
    piece.mesh.mesh.visible = true;
    piece.mesh.mat.opacity = 1;

    this.main.count = bi; // ribbon now ends at the cut
    this.cuts++; this.save('scissors.cuts', this.cuts);
    this.refreshStat();

    this.ctx.feedback.emit({ type: 'snip', intensity: 0.9 });
  }

  _getPiece() {
    let pick = this.pieces[0];
    for (const pc of this.pieces) if (pc.life < pick.life) pick = pc;
    return pick;
  }

  info() { return `<span class="num">${this.cuts}</span>cuts`; }
}

// --- Verlet rope ---
class Rope {
  constructor(max, segLen) {
    this.segLen = segLen;
    this.count = 0;
    this.nodes = [];
    for (let i = 0; i < max; i++) {
      this.nodes.push({ p: new THREE.Vector3(), q: new THREE.Vector3(), pinned: false });
    }
  }
  init(count, top) {
    this.count = count;
    for (let i = 0; i < count; i++) {
      this.nodes[i].p.set(top.x, top.y - i * this.segLen, top.z);
      this.nodes[i].q.copy(this.nodes[i].p);
      this.nodes[i].pinned = false;
    }
  }
  update(dt, iter = 10) {
    const g = -9 * dt * dt;
    for (let i = 0; i < this.count; i++) {
      const n = this.nodes[i];
      if (n.pinned) continue;
      const px = n.p.x, py = n.p.y, pz = n.p.z;
      n.p.x += (n.p.x - n.q.x) * 0.985;
      n.p.y += (n.p.y - n.q.y) * 0.985 + g;
      n.p.z += (n.p.z - n.q.z) * 0.985;
      n.q.set(px, py, pz);
    }
    for (let k = 0; k < iter; k++) {
      for (let i = 0; i < this.count - 1; i++) {
        const a = this.nodes[i], b = this.nodes[i + 1];
        _d.subVectors(b.p, a.p);
        const dist = _d.length() || 1e-6;
        const diff = (dist - this.segLen) / dist;
        if (a.pinned && b.pinned) continue;
        else if (a.pinned) b.p.addScaledVector(_d, -diff);
        else if (b.pinned) a.p.addScaledVector(_d, diff);
        else { a.p.addScaledVector(_d, 0.5 * diff); b.p.addScaledVector(_d, -0.5 * diff); }
      }
    }
  }
}

// --- ribbon strip mesh that follows a rope ---
class RibbonMesh {
  constructor(maxNodes, color, parent, fade = false) {
    this.w = 0.16;
    const geo = new THREE.BufferGeometry();
    this.posArr = new Float32Array(maxNodes * 2 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3));
    const nrm = new Float32Array(maxNodes * 2 * 3);
    for (let i = 0; i < maxNodes * 2; i++) nrm[i * 3 + 2] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    const idx = [];
    for (let i = 0; i < maxNodes - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    this.geo = geo;
    this.mat = new THREE.MeshStandardMaterial({
      color, roughness: 0.5, metalness: 0.0, side: THREE.DoubleSide,
      transparent: fade, emissive: 0x221a00, emissiveIntensity: 0.25,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false; // we keep the bounding sphere stale on purpose
    this.mesh.castShadow = true;
    this.mesh.visible = !fade;
    parent.add(this.mesh);
  }
  update(nodes, count) {
    const a = this.posArr;
    const hw = this.w * 0.5;
    for (let i = 0; i < count; i++) {
      const p = nodes[i].p;
      const prev = nodes[Math.max(0, i - 1)].p;
      const next = nodes[Math.min(count - 1, i + 1)].p;
      _tan.subVectors(next, prev);
      if (_tan.lengthSq() < 1e-8) _tan.set(0, -1, 0);
      _tan.normalize();
      _perp.crossVectors(_tan, _Z);
      if (_perp.lengthSq() < 1e-8) _perp.set(1, 0, 0);
      _perp.normalize();
      const li = i * 6;
      a[li] = p.x + _perp.x * hw; a[li + 1] = p.y + _perp.y * hw; a[li + 2] = p.z + _perp.z * hw;
      a[li + 3] = p.x - _perp.x * hw; a[li + 4] = p.y - _perp.y * hw; a[li + 5] = p.z - _perp.z * hw;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, (count - 1) * 6));
  }
}
