import * as THREE from 'three';

// =============================================================================
// Active-ragdoll physics (Euphoria-flavoured) — pure Verlet + PBD constraints.
//
// Why this approach: a generic rigid-body engine gives you a *passive* ragdoll
// (a sack of joints). Euphoria's magic is that the body is ACTIVE: muscles hold
// posture, it braces and staggers to keep balance, and it only goes truly limp
// when knocked out. We model that directly with a per-joint "muscle" force
// scaled by a CONSCIOUSNESS value:
//   - conscious  -> muscles pull toward a standing pose => it stands & recovers
//   - head shot  -> consciousness drops to 0 => muscles die => it faints / flops
//   - chest shot -> big impulse + partial consciousness loss => flung back, but
//                   muscles survive => it staggers and tries to stay up
// Everything is deterministic and headless-testable.
// =============================================================================

const GRAV = new THREE.Vector3(0, -18, 0);
const DAMP = 0.985;          // velocity retention per step (air)
const ITER = 10;             // constraint relaxation iterations
const MAX_SPEED = 60;        // clamp to keep the sim from exploding

// joint layout of a simple humanoid (standing, facing +z toward the camera)
const JOINTS = [
  ['head',   0.00, 1.62, 0.0, 1.4, 0.16],
  ['neck',   0.00, 1.45, 0.0, 1.0, 0.10],
  ['chest',  0.00, 1.28, 0.0, 3.0, 0.20],
  ['spine',  0.00, 1.12, 0.0, 2.0, 0.18],
  ['pelvis', 0.00, 0.95, 0.0, 3.0, 0.20],
  ['shL',   -0.18, 1.42, 0.0, 1.0, 0.12],
  ['shR',    0.18, 1.42, 0.0, 1.0, 0.12],
  ['elL',   -0.34, 1.16, 0.0, 0.8, 0.10],
  ['elR',    0.34, 1.16, 0.0, 0.8, 0.10],
  ['haL',   -0.40, 0.92, 0.0, 0.6, 0.10],
  ['haR',    0.40, 0.92, 0.0, 0.6, 0.10],
  ['hipL',  -0.12, 0.92, 0.0, 1.2, 0.13],
  ['hipR',   0.12, 0.92, 0.0, 1.2, 0.13],
  ['knL',   -0.13, 0.50, 0.0, 1.0, 0.12],
  ['knR',    0.13, 0.50, 0.0, 1.0, 0.12],
  ['ftL',   -0.13, 0.07, 0.0, 0.8, 0.12],
  ['ftR',    0.13, 0.07, 0.0, 0.8, 0.12],
];

// bones: [a, b, stiffness]  (distance constraints that hold the skeleton)
const BONES = [
  ['pelvis', 'spine', 1], ['spine', 'chest', 1], ['chest', 'neck', 1], ['neck', 'head', 1],
  ['chest', 'shL', 1], ['chest', 'shR', 1], ['neck', 'shL', 0.7], ['neck', 'shR', 0.7], ['shL', 'shR', 0.9],
  ['shL', 'elL', 0.95], ['elL', 'haL', 0.95], ['shR', 'elR', 0.95], ['elR', 'haR', 0.95],
  ['pelvis', 'hipL', 1], ['pelvis', 'hipR', 1], ['hipL', 'hipR', 0.95],
  ['hipL', 'knL', 0.97], ['knL', 'ftL', 0.97], ['hipR', 'knR', 0.97], ['knR', 'ftR', 0.97],
  // torso bracing so the trunk is semi-rigid (not a noodle)
  ['chest', 'pelvis', 0.85], ['chest', 'hipL', 0.5], ['chest', 'hipR', 0.5],
];

// which group a joint belongs to (drives hit reactions)
function groupOf(name) {
  if (name === 'head' || name === 'neck') return 'head';
  if (name === 'chest' || name === 'spine') return 'chest';
  if (name === 'pelvis' || name === 'hipL' || name === 'hipR') return 'pelvis';
  return 'limb';
}

// Joint LIMITS as min/max distance between the endpoints of a 2-bone chain.
// This is the clean Verlet trick for angle limits: a near-straight chain has a
// large end-to-end distance, a folded one a small distance. Clamping that
// distance to [min,max] of the straightened length prevents BOTH hyperextension
// (inverted elbow/knee) and over-folding — Euphoria never bends past anatomy.
// [endA, endB, minFrac, maxFrac] where fracs are of the straight (summed) length.
const LIMITS = [
  ['shL', 'haL', 0.30, 0.97], ['shR', 'haR', 0.30, 0.97],   // elbows
  ['hipL', 'ftL', 0.45, 0.98], ['hipR', 'ftR', 0.45, 0.98], // knees
  ['chest', 'head', 0.55, 1.02],                            // neck (no snapping)
  ['pelvis', 'chest', 0.80, 1.04],                          // spine (semi-rigid)
];

export class Ragdoll {
  constructor() {
    this.P = [];                 // particles
    this.byName = {};
    for (const [name, x, y, z, mass, r] of JOINTS) {
      const pos = new THREE.Vector3(x, y, z);
      const p = { name, pos, prev: pos.clone(), mass, invMass: 1 / mass, r, group: groupOf(name) };
      this.P.push(p); this.byName[name] = p;
    }
    this.bones = BONES.map(([a, b, s]) => {
      const pa = this.byName[a], pb = this.byName[b];
      return { a: pa, b: pb, rest: pa.pos.distanceTo(pb.pos), s };
    });
    // precompute the straight length of each limit chain (sum of its 2 bones)
    this.limits = LIMITS.map(([a, b, lo, hi]) => {
      const pa = this.byName[a], pb = this.byName[b];
      // straight length = direct distance when the chain is fully extended at spawn
      const straight = pa.pos.distanceTo(pb.pos);
      return { a: pa, b: pb, min: straight * lo, max: straight * hi };
    });
    this.flinch = 0;            // 0..1 self-protective brace level (raises after a hit)
    this.flinchDir = new THREE.Vector3(0, 0, -1);
    // rest posture offsets from the pelvis (the "muscle memory" of standing)
    this.restOff = {};
    const pv = this.byName['pelvis'].pos;
    for (const p of this.P) this.restOff[p.name] = p.pos.clone().sub(pv);
    this.hipHeight = pv.y;       // how high the pelvis floats above the feet
    this.spawn0 = this.P.map((p) => p.pos.clone());

    this.consciousness = 1;      // 1 = fully awake, 0 = knocked out (limp)
    this.health = 1;
  }

  reset(offset = new THREE.Vector3()) {
    for (let i = 0; i < this.P.length; i++) {
      this.P[i].pos.copy(this.spawn0[i]).add(offset);
      this.P[i].prev.copy(this.P[i].pos);
    }
    this.consciousness = 1; this.health = 1;
    this.flinch = 0; this._woundJoint = null; this._clutchHand = null;
    this._stepFoot = null; this._stepT = 1; this._stepCool = 0;
  }

  get knockedOut() { return this.consciousness <= 0.02; }

  // center of mass (for scoring / camera)
  com(out = new THREE.Vector3()) {
    out.set(0, 0, 0); let m = 0;
    for (const p of this.P) { out.addScaledVector(p.pos, p.mass); m += p.mass; }
    return out.multiplyScalar(1 / m);
  }

  // ---- the simulation step --------------------------------------------------
  step(dt, env) {
    dt = Math.min(dt, 1 / 60);
    const dt2 = dt * dt;

    // 1) Verlet integration with clamped velocity
    for (const p of this.P) {
      const vx = (p.pos.x - p.prev.x) * DAMP;
      const vy = (p.pos.y - p.prev.y) * DAMP;
      const vz = (p.pos.z - p.prev.z) * DAMP;
      p.prev.copy(p.pos);
      let nvx = vx + GRAV.x * dt2, nvy = vy + GRAV.y * dt2, nvz = vz + GRAV.z * dt2;
      const sp = Math.hypot(nvx, nvy, nvz);
      if (sp > MAX_SPEED * dt) { const k = (MAX_SPEED * dt) / sp; nvx *= k; nvy *= k; nvz *= k; }
      p.pos.set(p.pos.x + nvx, p.pos.y + nvy, p.pos.z + nvz);
    }

    // 2) MUSCLES — the active-ragdoll heart. While conscious, pull joints toward
    //    the standing pose; strength scales with consciousness, so a KO body
    //    (consciousness 0) gets nothing and collapses into a pure ragdoll.
    this._muscles(env, dt);

    // 3) constraint relaxation (bone lengths) + ANGLE LIMITS + collisions
    for (let it = 0; it < ITER; it++) {
      for (const c of this.bones) this._solveBone(c);
      for (const L of this.limits) this._solveLimit(L);   // no inverted joints
      this._collide(env);
    }

    // flinch decays; consciousness slowly recovers while alive
    this.flinch = Math.max(0, this.flinch - 1.2 * dt);
    if (this.consciousness > 0.02) this.consciousness = Math.min(1, this.consciousness + 0.06 * dt);
  }

  _muscles(env, dt) {
    const k = this.consciousness * (this.muscleScale ?? 1);  // host can relax muscles (mid-flip tuck) then re-engage to catch a landing
    if (k <= 0.02) return;       // knocked out / fully relaxed => no muscle => limp
    const stand = 0.16 * k;      // posture stiffness
    const balance = 0.5 * k;     // how hard it fights to stay over its feet

    const ftL = this.byName['ftL'].pos, ftR = this.byName['ftR'].pos;
    const fmX = (ftL.x + ftR.x) * 0.5, fmZ = (ftL.z + ftR.z) * 0.5;
    const groundY = env.groundY(fmX, fmZ);
    const pelvis = this.byName['pelvis'];

    // pull the pelvis to float above the foot midpoint at hip height (balance)
    const tpx = fmX, tpy = groundY + this.hipHeight, tpz = fmZ;
    pelvis.pos.x = lerp(pelvis.pos.x, tpx, balance * 0.35);
    pelvis.pos.y = lerp(pelvis.pos.y, tpy, balance * 0.5);
    pelvis.pos.z = lerp(pelvis.pos.z, tpz, balance * 0.35);

    // ---- PROTECTIVE STEPPING — the true Euphoria balance recovery -----------
    // Where is the CoM relative to the foot base? If it has drifted past the
    // support, the figure must STEP a foot out under the falling CoM to catch
    // itself (a stagger), not just stiffly snap back. This is what turns a chest
    // shove into a believable backward stagger-and-recover.
    const com = this.com(this._comTmp || (this._comTmp = new THREE.Vector3()));
    const offX = com.x - fmX, offZ = com.z - fmZ;
    const lean = Math.hypot(offX, offZ);
    const STEP_TRIG = 0.16;       // CoM drift that triggers a catch-step
    if (this._stepCool === undefined) this._stepCool = 0;
    this._stepCool = Math.max(0, this._stepCool - dt);

    if (lean > STEP_TRIG && this._stepCool === 0) {
      // step the foot that is on the TRAILING side (behind the fall) out past CoM
      const nx = offX / lean, nz = offZ / lean;
      const dL = (ftL.x - fmX) * nx + (ftL.z - fmZ) * nz;
      const dR = (ftR.x - fmX) * nx + (ftR.z - fmZ) * nz;
      this._stepFoot = dL < dR ? 'ftL' : 'ftR';
      // target sits just past the foot midpoint toward the fall — a small,
      // BOUNDED stagger (≤ STRIDE), so it catches itself instead of moonwalking.
      const STRIDE = 0.42;
      const reach = Math.min(lean + 0.12, STRIDE);
      this._stepTarget = { x: fmX + nx * reach, z: fmZ + nz * reach };
      this._stepT = 0; this._stepCool = 0.42;     // pacing between steps
    }

    // pull the rest of the body toward pelvis + its standing offset (posture)
    for (const p of this.P) {
      if (p.name === 'pelvis') continue;
      const off = this.restOff[p.name];
      if (p.name === 'ftL' || p.name === 'ftR') {
        // a foot that is mid-step lifts and reaches its catch target; otherwise
        // it stays planted under the hips.
        if (this._stepFoot === p.name && this._stepT < 1) {
          this._stepT = Math.min(1, this._stepT + dt / 0.18);
          const lift = Math.sin(this._stepT * Math.PI) * 0.22;   // arc up then down
          p.pos.x = lerp(p.pos.x, this._stepTarget.x, 0.4);
          p.pos.z = lerp(p.pos.z, this._stepTarget.z, 0.4);
          p.pos.y = lerp(p.pos.y, env.groundY(p.pos.x, p.pos.z) + p.r + lift, 0.5);
        } else {
          const tx = pelvis.pos.x + off.x, tz = pelvis.pos.z + off.z;
          p.pos.x = lerp(p.pos.x, tx, stand * 0.5);
          p.pos.z = lerp(p.pos.z, tz, stand * 0.5);
        }
        continue;
      }
      p.pos.x = lerp(p.pos.x, pelvis.pos.x + off.x, stand);
      p.pos.y = lerp(p.pos.y, pelvis.pos.y + off.y, stand);
      p.pos.z = lerp(p.pos.z, pelvis.pos.z + off.z, stand);
    }

    // PROTECTIVE BRACE — Euphoria's signature. When recently hit (flinch>0) and
    // still conscious, a hand reaches toward the WOUND (clutch) while the other
    // shields the head; the head tucks away from the blow and the chest ducks.
    if (this.flinch > 0.02) {
      const f = this.flinch * k;
      const head = this.byName['head'].pos;
      const reach = clamp(0.85 * f, 0, 0.9);
      // clutch hand -> the live struck joint; guard hand -> the face
      const clutch = this._clutchHand || 'haR', guard = clutch === 'haR' ? 'haL' : 'haR';
      const wj = this._woundJoint;
      if (wj && wj.name !== clutch) {
        const w = wj.pos, hc = this.byName[clutch].pos;
        hc.x = lerp(hc.x, w.x, reach); hc.y = lerp(hc.y, w.y + 0.06, reach); hc.z = lerp(hc.z, w.z + 0.1, reach);
      }
      const hg = this.byName[guard].pos, sx = guard === 'haL' ? -0.1 : 0.1;
      hg.x = lerp(hg.x, head.x + sx, reach); hg.y = lerp(hg.y, head.y - 0.05, reach); hg.z = lerp(hg.z, head.z + 0.2, reach);
      head.x = lerp(head.x, head.x - this.flinchDir.x * 0.12 * f, 0.5);
      const chest = this.byName['chest'].pos;
      chest.y = lerp(chest.y, chest.y - 0.08 * f, 0.4);
    }
  }

  _solveBone(c) {
    const ax = c.a.pos, bx = c.b.pos;
    let dx = bx.x - ax.x, dy = bx.y - ax.y, dz = bx.z - ax.z;
    let d = Math.hypot(dx, dy, dz) || 1e-6;
    const diff = ((d - c.rest) / d) * c.s * 0.5;
    const wa = c.a.invMass / (c.a.invMass + c.b.invMass);
    const wb = 1 - wa;
    dx *= diff; dy *= diff; dz *= diff;
    ax.x += dx * wa * 2 * 0.5; ax.y += dy * wa * 2 * 0.5; ax.z += dz * wa * 2 * 0.5;
    bx.x -= dx * wb * 2 * 0.5; bx.y -= dy * wb * 2 * 0.5; bx.z -= dz * wb * 2 * 0.5;
  }

  // clamp the end-to-end distance of a 2-bone chain into [min,max] so the joint
  // can neither hyperextend (invert) nor crush through itself.
  _solveLimit(L) {
    const ax = L.a.pos, bx = L.b.pos;
    let dx = bx.x - ax.x, dy = bx.y - ax.y, dz = bx.z - ax.z;
    let d = Math.hypot(dx, dy, dz) || 1e-6;
    let target = d;
    if (d > L.max) target = L.max; else if (d < L.min) target = L.min; else return;
    const diff = ((d - target) / d) * 0.5;
    const wa = L.a.invMass / (L.a.invMass + L.b.invMass), wb = 1 - wa;
    dx *= diff; dy *= diff; dz *= diff;
    ax.x += dx * wa; ax.y += dy * wa; ax.z += dz * wa;
    bx.x -= dx * wb; bx.y -= dy * wb; bx.z -= dz * wb;
  }

  _collide(env) {
    for (const p of this.P) {
      // ground (supports slopes via groundY/normal)
      const gy = env.groundY(p.pos.x, p.pos.z) + p.r;
      if (p.pos.y < gy) {
        p.pos.y = gy;
        // friction: damp horizontal velocity so feet grip and it can stand
        const vx = p.pos.x - p.prev.x, vz = p.pos.z - p.prev.z;
        const fr = 0.55;
        p.prev.x = p.pos.x - vx * fr;
        p.prev.z = p.pos.z - vz * fr;
        if (p.prev.y > p.pos.y) p.prev.y = p.pos.y;   // kill downward velocity
      }
      // box obstacles / platforms (AABB, push out least-penetration axis)
      if (env.boxes) for (const bx of env.boxes) {
        const r = p.r;
        if (p.pos.x > bx.min.x - r && p.pos.x < bx.max.x + r &&
            p.pos.y > bx.min.y - r && p.pos.y < bx.max.y + r &&
            p.pos.z > bx.min.z - r && p.pos.z < bx.max.z + r) {
          const px1 = (bx.max.x + r) - p.pos.x, px2 = p.pos.x - (bx.min.x - r);
          const py1 = (bx.max.y + r) - p.pos.y, py2 = p.pos.y - (bx.min.y - r);
          const pz1 = (bx.max.z + r) - p.pos.z, pz2 = p.pos.z - (bx.min.z - r);
          const m = Math.min(px1, px2, py1, py2, pz1, pz2);
          if (m === px1) p.pos.x = bx.max.x + r; else if (m === px2) p.pos.x = bx.min.x - r;
          else if (m === py1) { p.pos.y = bx.max.y + r; const vx = p.pos.x - p.prev.x, vz = p.pos.z - p.prev.z; p.prev.x = p.pos.x - vx * 0.6; p.prev.z = p.pos.z - vz * 0.6; }
          else if (m === py2) p.pos.y = bx.min.y - r;
          else if (m === pz1) p.pos.z = bx.max.z + r; else p.pos.z = bx.min.z - r;
        }
      }
    }
  }

  // ---- the hit reaction (the requested behaviour) ---------------------------
  // point: world hit position; dir: arrow travel direction (normalized); power:
  // arrow speed at impact. Returns info { part, ko, impulse } for scoring/fx.
  hit(point, dir, power) {
    // nearest particle to the hit point
    let p = null, best = Infinity;
    for (const q of this.P) {
      const d = q.pos.distanceToSquared(point);
      if (d < best) { best = d; p = q; }
    }
    const grp = p.group;
    const J = power * 0.06;                 // impulse magnitude from arrow speed

    // raise the self-protective brace (hands fly up to guard) — but a clean head
    // KO skips it: you can't brace if you're already out cold.
    this.flinchDir.copy(dir).normalize();
    if (grp !== 'head') {
      this.flinch = Math.min(1, this.flinch + clamp(power / 70, 0.3, 1));
      // clutch the STRUCK JOINT (it moves, so the hand tracks the live wound).
      // a hand never clutches itself — pick the opposite hand for hand/arm hits.
      this._woundJoint = p;
      let cand = ['haL', 'haR'];
      if (p.name === 'haL' || p.name === 'elL') cand = ['haR'];
      else if (p.name === 'haR' || p.name === 'elR') cand = ['haL'];
      this._clutchHand = cand.length === 1 ? cand[0]
        : (this.byName['haL'].pos.distanceToSquared(point) < this.byName['haR'].pos.distanceToSquared(point) ? 'haL' : 'haR');
    }

    // apply the impulse to the struck joint, with falloff to its neighbours so
    // the whole limb/torso reacts as a chain (not a single dot popping)
    this._impulse(p, dir, J);
    for (const c of this.bones) {
      if (c.a === p) this._impulse(c.b, dir, J * 0.35);
      else if (c.b === p) this._impulse(c.a, dir, J * 0.35);
    }

    let ko = false;
    if (grp === 'head') {
      // HEAD SHOT: instant faint — consciousness collapses, body goes limp.
      this.consciousness = 0; ko = true;
      this.health = Math.max(0, this.health - 0.6);
    } else if (grp === 'chest') {
      // CHEST: flung back (impulse above), staggered but NOT instantly out.
      // Only a very powerful shot (or repeated ones) knocks it out.
      this.consciousness = Math.max(0, this.consciousness - clamp(power / 90, 0.1, 0.7));
      this.health = Math.max(0, this.health - 0.3);
      if (this.consciousness <= 0.02) ko = true;
    } else if (grp === 'pelvis') {
      this.consciousness = Math.max(0, this.consciousness - clamp(power / 130, 0.05, 0.4));
      this.health = Math.max(0, this.health - 0.2);
    } else {
      // limb: mostly local impulse, tiny consciousness cost
      this.consciousness = Math.max(0, this.consciousness - 0.04);
      this.health = Math.max(0, this.health - 0.1);
    }
    return { part: p.name, group: grp, ko, impulse: J, joint: p };
  }

  _impulse(p, dir, mag) {
    // add velocity dv = (dir*mag)/mass by shifting prev against the motion
    const dv = mag * p.invMass;
    p.prev.x -= dir.x * dv;
    p.prev.y -= dir.y * dv;
    p.prev.z -= dir.z * dv;
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
