import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const HALF = 56;            // arena half-size

// --- tuning (arcade drift feel) -------------------------------------------
const ENGINE = 15;         // forward acceleration
const MAX_SPD = 18;        // top speed
const LIN_DRAG = 0.9;      // rolling resistance
const TURN = 2.5;          // base turn rate (rad/s)
const TURN_REF = 6;        // speed for full steering authority
const GRIP_HIGH = 7.5;     // lateral grip when gripping
const GRIP_LOW = 1.3;      // lateral grip while drifting (slides)

export class Game {
  constructor(canvas, audio, input, hud) {
    this.audio = audio; this.input = input; this.hud = hud;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06070b);
    this.scene.fog = new THREE.Fog(0x06070b, 34, 92);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 400);
    this.camPos = new THREE.Vector3(0, 32, -14); // behind north-up, slight tilt

    this._lights();
    this._world();
    this._car();
    this._skids();
    this._smoke();
    this._cones(26);

    // state
    this.pos = new THREE.Vector2(0, 0);   // x, z
    this.vel = new THREE.Vector2(0, 0);
    this.theta = 0;
    this.lat = 0; this.fwd = 0;
    this.best = this._loadBest();
    this.score = 0;
    this.pending = 0; this.driftTime = 0; this.mult = 1; this.notDrift = 0;
    this.running = false;
    this.hud.setBest(this.best);

    this.clock = new THREE.Clock();
    addEventListener('resize', () => this._resize());
    this._resize();
  }

  _lights() {
    this.scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x0a0c12, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 80;
    const d = 22; Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
    sun.shadow.bias = -0.0005;
    this.scene.add(sun); this.scene.add(sun.target);
    this.sun = sun;
  }

  _world() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF * 2 + 40, HALF * 2 + 40),
      new THREE.MeshStandardMaterial({ color: 0x16181e, roughness: 0.96, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(HALF * 2, 28, 0x2a2f3a, 0x1c2028);
    grid.position.y = 0.02; this.scene.add(grid);

    // boundary walls
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x0a84ff, roughness: 0.5, emissive: 0x0a2a55, emissiveIntensity: 0.6 });
    for (const s of [-1, 1]) {
      const wx = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2, 1.2, 0.6), wallMat);
      wx.position.set(0, 0.6, s * HALF); wx.castShadow = wx.receiveShadow = true; this.scene.add(wx);
      const wz = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, HALF * 2), wallMat);
      wz.position.set(s * HALF, 0.6, 0); wz.castShadow = wz.receiveShadow = true; this.scene.add(wz);
    }
  }

  _car() {
    this.car = new THREE.Group();
    this.car.rotation.order = 'YXZ';
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.9, 1.6, 4, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x0a84ff, roughness: 0.35, metalness: 0.3 }));
    body.position.y = 0.55; body.castShadow = true; this.car.add(body);
    // darker cabin
    const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.5, 0.9, 4, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.3, metalness: 0.5 }));
    cabin.position.set(0, 1.0, -0.05); cabin.castShadow = true; this.car.add(cabin);
    // bright front stripe (shows heading)
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xbcd6ff, emissiveIntensity: 0.5, roughness: 0.4 }));
    nose.position.set(0, 0.55, 0.82); this.car.add(nose);
    this.carBody = body;
    this.scene.add(this.car);
  }

  _skids() {
    this.skidMat0 = new THREE.MeshBasicMaterial({ color: 0x05060a, transparent: true, opacity: 0.5, depthWrite: false });
    const geo = new THREE.BoxGeometry(0.24, 0.02, 0.55);
    this.skids = [];
    for (let i = 0; i < 220; i++) {
      const m = new THREE.Mesh(geo, this.skidMat0.clone());
      m.visible = false; m.renderOrder = 1; this.scene.add(m);
      this.skids.push({ mesh: m, life: 0 });
    }
    this.skidCursor = 0; this.skidTimer = 0;
  }

  _smoke() {
    const tex = makePuff();
    this.smoke = [];
    for (let i = 0; i < 28; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.visible = false; this.scene.add(m);
      this.smoke.push({ mesh: m, life: 0, vx: 0, vz: 0, size: 1 });
    }
    this.smokeCursor = 0; this.smokeTimer = 0;
  }

  _cones(n) {
    this.cones = [];
    const coneGeo = new THREE.ConeGeometry(0.32, 0.85, 16);
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6, emissive: 0x3a1500, emissiveIntensity: 0.4 });
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(coneGeo, coneMat);
      m.castShadow = true;
      this._placeCone(m);
      this.scene.add(m);
      this.cones.push({ mesh: m, vx: 0, vz: 0, spin: 0 });
    }
  }
  _placeCone(m) {
    let x, z;
    do { x = (Math.random() * 2 - 1) * (HALF - 6); z = (Math.random() * 2 - 1) * (HALF - 6); }
    while (Math.hypot(x, z) < 8);
    m.position.set(x, 0.42, z); m.rotation.set(0, Math.random() * 6, 0);
  }

  start() { this.running = true; this.clock.getDelta(); this._loop(); }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 1 / 30);
    if (this.running) this._update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  _update(dt) {
    const steer = this.input.steer;
    const drift = this.input.drift;

    // decompose velocity in the car frame
    const fwdV = new THREE.Vector2(Math.sin(this.theta), Math.cos(this.theta));
    const rightV = new THREE.Vector2(Math.cos(this.theta), -Math.sin(this.theta));
    let fwd = this.vel.dot(fwdV);
    let lat = this.vel.dot(rightV);

    // engine + rolling resistance
    fwd += ENGINE * dt;
    fwd -= fwd * LIN_DRAG * dt;
    fwd = clamp(fwd, -3, MAX_SPD);

    // steering -> heading; sharper while drifting
    const speed = this.vel.length();
    const authority = clamp(Math.abs(fwd) / TURN_REF, 0, 1);
    const turn = steer * TURN * authority * (drift ? 1.6 : 1.0);
    this.theta += turn * dt * (fwd >= 0 ? 1 : -1);

    // lateral grip (low while drifting => slides)
    const grip = drift ? GRIP_LOW : GRIP_HIGH;
    lat -= lat * grip * dt;

    // recompose with the NEW heading (this mismatch is the drift)
    const fwd2 = new THREE.Vector2(Math.sin(this.theta), Math.cos(this.theta));
    const right2 = new THREE.Vector2(Math.cos(this.theta), -Math.sin(this.theta));
    this.vel.set(fwd2.x * fwd + right2.x * lat, fwd2.y * fwd + right2.y * lat);
    this.fwd = fwd; this.lat = lat;

    // integrate + boundary bounce
    this.pos.addScaledVector(this.vel, dt);
    for (const ax of ['x', 'y']) {
      if (this.pos[ax] > HALF - 1) { this.pos[ax] = HALF - 1; this.vel[ax] *= -0.4; }
      if (this.pos[ax] < -(HALF - 1)) { this.pos[ax] = -(HALF - 1); this.vel[ax] *= -0.4; }
    }

    // place car + body lean
    this.car.position.set(this.pos.x, 0, this.pos.y);
    this.car.rotation.y = this.theta;
    this.car.rotation.z += (clamp(-lat * 0.05, -0.28, 0.28) - this.car.rotation.z) * Math.min(1, dt * 10);

    // --- drift detection / scoring ---
    const slip = speed > 0.5 ? Math.acos(clamp(fwd / speed, -1, 1)) * 180 / Math.PI : 0;
    const drifting = speed > 4 && slip > 12 && slip < 110;
    const driftAmt = drifting ? clamp((slip - 12) / 50, 0, 1) : 0;

    if (drifting) {
      this.driftTime += dt; this.notDrift = 0;
      this.mult = clamp(1 + Math.floor(this.driftTime / 1.4), 1, 8);
      this.pending += speed * driftAmt * dt * 8;
      this.hud.setCombo(this.mult, Math.floor(this.pending * this.mult), true);
    } else if (this.pending > 0) {
      this.notDrift += dt;
      if (this.notDrift > 0.5) this._bank();
    }

    // --- skids ---
    this.skidTimer += dt;
    if (driftAmt > 0.12 && speed > 4 && this.skidTimer > 0.022) {
      this.skidTimer = 0;
      const a = Math.atan2(this.vel.x, this.vel.y);
      this._dropSkid(-0.55, 0.6, a); this._dropSkid(-0.55, -0.6, a);
      this._emitSmoke(driftAmt);
    }
    this._fadeSkids(dt);
    this._updateSmoke(dt);
    this._updateCones(dt);

    // --- camera follow (top-down, north-up, slight tilt) ---
    const lead = this.vel.clone().multiplyScalar(0.28);
    const tx = this.pos.x + lead.x, tz = this.pos.y + lead.y;
    const want = new THREE.Vector3(tx, 32, tz - 13);
    this.camPos.lerp(want, Math.min(1, dt * 4));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(tx, 0, tz);

    // light follows car
    this.sun.position.set(this.pos.x + 12, 26, this.pos.y + 6);
    this.sun.target.position.set(this.pos.x, 0, this.pos.y);
    this.sun.target.updateMatrixWorld();

    // audio
    this.audio.engine(clamp(Math.abs(fwd) / MAX_SPD, 0, 1));
    this.audio.screech(driftAmt * clamp(speed / 10, 0, 1));

    this.hud.setScore(this.score);
  }

  _bank() {
    const gained = Math.floor(this.pending * this.mult);
    this.score += gained;
    if (this.score > this.best) { this.best = this.score; this._saveBest(this.best); this.hud.setBest(this.best); }
    this.audio.bank(this.mult);
    this.hud.bankFlash(gained, this.mult);
    this.pending = 0; this.driftTime = 0; this.mult = 1; this.notDrift = 0;
    this.hud.setCombo(1, 0, false);
  }

  _dropSkid(offF, offR, angle) {
    const f = new THREE.Vector2(Math.sin(this.theta), Math.cos(this.theta));
    const r = new THREE.Vector2(Math.cos(this.theta), -Math.sin(this.theta));
    const x = this.pos.x + f.x * offF + r.x * offR;
    const z = this.pos.y + f.y * offF + r.y * offR;
    const s = this.skids[this.skidCursor]; this.skidCursor = (this.skidCursor + 1) % this.skids.length;
    s.mesh.position.set(x, 0.03, z);
    s.mesh.rotation.y = angle;
    s.mesh.material.opacity = 0.5;
    s.mesh.visible = true; s.life = 1;
  }
  _fadeSkids(dt) {
    for (const s of this.skids) {
      if (s.life <= 0) continue;
      s.life -= dt * 0.18;
      s.mesh.material.opacity = Math.max(0, s.life) * 0.5;
      if (s.life <= 0) s.mesh.visible = false;
    }
  }

  _emitSmoke(amt) {
    this.smokeTimer = (this.smokeTimer || 0);
    const f = new THREE.Vector2(Math.sin(this.theta), Math.cos(this.theta));
    const p = this.smoke[this.smokeCursor]; this.smokeCursor = (this.smokeCursor + 1) % this.smoke.length;
    p.mesh.position.set(this.pos.x - f.x * 0.6, 0.1, this.pos.y - f.y * 0.6);
    p.size = 0.6; p.life = 1;
    p.vx = (Math.random() - 0.5) * 1.5 - this.vel.x * 0.1;
    p.vz = (Math.random() - 0.5) * 1.5 - this.vel.y * 0.1;
    p.mesh.material.opacity = 0.35 * amt; p.mesh.visible = true;
  }
  _updateSmoke(dt) {
    for (const p of this.smoke) {
      if (p.life <= 0) continue;
      p.life -= dt * 0.9;
      p.size += dt * 3;
      p.mesh.position.x += p.vx * dt; p.mesh.position.z += p.vz * dt;
      p.mesh.scale.setScalar(p.size);
      p.mesh.material.opacity = Math.max(0, p.life) * 0.3;
      if (p.life <= 0) p.mesh.visible = false;
    }
  }

  _updateCones(dt) {
    const carR = 1.1;
    for (const c of this.cones) {
      const m = c.mesh;
      const dx = m.position.x - this.pos.x, dz = m.position.z - this.pos.y;
      const dist = Math.hypot(dx, dz);
      if (dist < carR + 0.4) {
        const n = 1 / (dist || 1);
        const impact = clamp(this.vel.length(), 4, 22);
        c.vx = dx * n * impact + this.vel.x * 0.4;
        c.vz = dz * n * impact + this.vel.y * 0.4;
        c.spin = (Math.random() - 0.5) * 14;
      }
      if (Math.abs(c.vx) + Math.abs(c.vz) > 0.01) {
        m.position.x += c.vx * dt; m.position.z += c.vz * dt;
        c.vx *= Math.pow(0.06, dt); c.vz *= Math.pow(0.06, dt);
        m.rotation.x += c.spin * dt * 0.3; m.rotation.z += c.spin * dt * 0.2;
        c.spin *= Math.pow(0.2, dt);
        m.position.x = clamp(m.position.x, -HALF + 1, HALF - 1);
        m.position.z = clamp(m.position.z, -HALF + 1, HALF - 1);
      }
    }
  }

  _loadBest() { try { return +localStorage.getItem('drift.best') || 0; } catch { return 0; } }
  _saveBest(v) { try { localStorage.setItem('drift.best', String(v)); } catch {} }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
}

// soft radial puff texture for smoke/dust
function makePuff() {
  const s = 64; const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(220,225,235,0.9)');
  grd.addColorStop(0.5, 'rgba(200,205,215,0.35)');
  grd.addColorStop(1, 'rgba(200,205,215,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}
