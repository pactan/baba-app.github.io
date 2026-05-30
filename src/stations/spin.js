import * as THREE from 'three';
import { Station } from './base.js';
import { Stage } from '../stage.js';
import { M, lathe, clamp } from '../util.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// 03 — Spin. A weighted machined tri-spinner facing the camera, rotating about
// Z, mounted on a small turned post and floating just above it. The hub has a
// real visible bearing (turned inner/outer races + a torus race ring); each arm
// ends in a proper weighted bearing cap (outer ring + capped centre + bevel) in
// brushed aluminium.
//
// Mechanics: angular velocity omega with bearing friction (small constant term
// + drag proportional to |omega|) so a hard flick spins ~10-30s. Release
// velocity is captured from the drag (angle deltas / time). Tap-the-centre adds
// friction and a scrape noiseTone (brake). A continuous bearing whir (tone)
// rises in pitch/gain with RPM. A per-rev 'detent' haptic fires only at low
// RPM. A faint additive motion ghost appears at high RPM (skipped if
// reducedMotion). Max RPM persisted under 'spin.maxrpm'.
const PIVOT_Y = 0.95;
const ARM = 0.86;          // hub-centre to weight-centre
const CAP_R = 0.34;        // weighted bearing-cap radius
const HUB_R = 0.36;

export class SpinStation extends Station {
  get title() { return 'Spin'; }
  get index() { return '03'; }
  frame() { return { y: PIVOT_Y, halfW: 1.35, halfH: 1.3 }; }

  build() {
    this.maxRpm = this.load('spin.maxrpm', 0);
    this.omega = 0;        // angular velocity (rad/s) about Z, faces camera
    this.angle = 0;
    this.dragging = false;
    this.braking = false;
    this.lastRev = 0;

    const alu = () => M.alu(0xd2d6dd);
    const dark = () => M.darkMetal(0x2b2e35);

    // ---- turned post + base the spinner floats above ------------------------
    const baseMat = M.darkMetal(0x24272e);
    const stand = lathe([
      [0.00, 0.00],
      [0.62, 0.00],
      [0.64, 0.04],
      [0.58, 0.07],   // foot bevel
      [0.22, 0.10],
      [0.17, 0.18],   // slim neck
      [0.16, PIVOT_Y - 0.30],
      [0.20, PIVOT_Y - 0.20],  // shoulder under the spinner
      [0.16, PIVOT_Y - 0.14],
      [0.10, PIVOT_Y - 0.10],
      [0.00, PIVOT_Y - 0.10],
    ], baseMat, 64);
    stand.castShadow = stand.receiveShadow = true;
    this.group.add(stand);
    // Rubber foot pad.
    const pad = lathe([[0.20, 0], [0.6, 0], [0.6, 0.018], [0.2, 0.018], [0.2, 0]],
      M.rubber(0x14161b), 48);
    pad.position.y = 0.001;
    this.group.add(pad);
    // Polished bolt cap on top of the post (the bearing's mounting screw).
    const boltCap = lathe([
      [0.00, PIVOT_Y - 0.10], [0.085, PIVOT_Y - 0.10],
      [0.085, PIVOT_Y - 0.05], [0.05, PIVOT_Y - 0.03], [0.00, PIVOT_Y - 0.03],
    ], M.polishedSteel(), 32);
    this.group.add(boltCap);

    // ---- spinner ------------------------------------------------------------
    this.spinner = new THREE.Group();
    this.spinner.position.set(0, PIVOT_Y, 0);
    this.group.add(this.spinner);

    this.spinner.add(this._buildSpinner(alu, dark));

    // ---- motion ghost: a faint additive copy that shows speed ---------------
    this.ghost = this.spinner.clone(true);
    this.ghost.position.set(0, PIVOT_Y, 0);
    this.ghost.traverse((o) => {
      if (o.isMesh) {
        o.material = new THREE.MeshBasicMaterial({
          color: 0x9fc0ff, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        o.castShadow = o.receiveShadow = false;
      }
    });
    this.ghost.visible = false;
    this.group.add(this.ghost);

    // Big invisible disc so the whole area reliably catches the flick gesture.
    const grab = new THREE.Mesh(new THREE.CircleGeometry(1.3, 40),
      new THREE.MeshBasicMaterial({ visible: false }));
    grab.position.set(0, PIVOT_Y, 0.32);
    this.group.add(grab);
    this.interactive = [grab];

    this.group.add(Stage.contactShadow(1.5, 0.42));
    this.whir = null;
    this.scrape = null;
  }

  // Builds one finished tri-spinner body centred on the spinner pivot, lying in
  // the XY plane so it faces the camera (+Z).
  _buildSpinner(alu, dark) {
    const g = new THREE.Group();
    const Zturn = Math.PI / 2; // lathe parts are built around Y; lay them to face +Z

    // Central body plate joining the three arms — a rounded triangular slab made
    // from a thick disc; the arms blend into it.
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(HUB_R + 0.02, HUB_R + 0.02, 0.16, 48), alu());
    plate.rotation.x = Zturn; plate.castShadow = plate.receiveShadow = true;
    g.add(plate);

    // ---- real centre bearing: nested turned races + a torus race ring -------
    // Outer race (turned ring), inner race, and a visible ball-race torus.
    const outerRace = lathe([
      [0.30, -0.10], [0.30, 0.10], [0.24, 0.10], [0.24, 0.06],
      [0.21, 0.06], [0.21, -0.06], [0.24, -0.06], [0.24, -0.10], [0.30, -0.10],
    ], dark(), 48);
    outerRace.rotation.x = Zturn; outerRace.castShadow = true;
    g.add(outerRace);
    const raceRing = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.03, 16, 48), M.polishedSteel());
    g.add(raceRing); // already in XY plane, faces camera
    const innerRace = lathe([
      [0.00, -0.11], [0.165, -0.11], [0.165, 0.11], [0.00, 0.11], [0.00, -0.11],
    ], M.polishedSteel(), 40);
    innerRace.rotation.x = Zturn;
    g.add(innerRace);
    // A small dished centre button.
    const button = lathe([
      [0.00, 0.11], [0.10, 0.115], [0.13, 0.13], [0.10, 0.145], [0.00, 0.145],
    ], dark(), 32);
    button.rotation.x = Zturn;
    g.add(button);
    const buttonBack = button.clone(); buttonBack.rotation.x = -Zturn;
    g.add(buttonBack); // mirror so the back reads finished on orbit

    // ---- three arms, each a neck + weighted bearing cap ---------------------
    const capGeo = this._capParts(alu, dark);
    for (let i = 0; i < 3; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = (i / 3) * Math.PI * 2;

      // Tapered neck from the hub out to the cap, slightly waisted.
      const neck = new THREE.Mesh(this._neckGeo(), alu());
      neck.castShadow = neck.receiveShadow = true;
      arm.add(neck);

      const cap = capGeo.clone(true);
      cap.position.y = ARM;
      arm.add(cap);

      g.add(arm);
    }
    return g;
  }

  // A neck geometry: an extruded waisted bar pointing +Y from the hub.
  _neckGeo() {
    const shape = new THREE.Shape();
    const w0 = 0.30, w1 = 0.30, wm = 0.20; // waist in the middle
    const y0 = 0.12, y1 = ARM - CAP_R + 0.18;
    shape.moveTo(-w0, y0);
    shape.quadraticCurveTo(-wm, (y0 + y1) / 2, -w1, y1);
    shape.lineTo(w1, y1);
    shape.quadraticCurveTo(wm, (y0 + y1) / 2, w0, y0);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.14, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025,
      bevelSegments: 3, curveSegments: 16,
    });
    geo.translate(0, 0, -0.07);
    geo.computeVertexNormals();
    return geo;
  }

  // A weighted bearing cap: outer turned ring + capped centre + bevel + a tiny
  // visible bearing torus, built around Y then laid to face the camera.
  _capParts(alu, dark) {
    const cap = new THREE.Group();
    const Zturn = Math.PI / 2;

    // Outer weighted ring (the mass at the tip).
    const ring = lathe([
      [CAP_R, -0.11], [CAP_R, 0.11],
      [CAP_R - 0.02, 0.13], [CAP_R - 0.11, 0.13],
      [CAP_R - 0.11, 0.07], [CAP_R - 0.16, 0.05],   // step down into the recess
      [CAP_R - 0.16, -0.05], [CAP_R - 0.11, -0.07],
      [CAP_R - 0.11, -0.13], [CAP_R - 0.02, -0.13],
      [CAP_R, -0.11],
    ], dark(), 48);
    ring.rotation.x = Zturn; ring.castShadow = ring.receiveShadow = true;
    cap.add(ring);

    // Brushed-alu inset disc inside the ring with a bevel.
    const disc = lathe([
      [0.00, 0.06], [CAP_R - 0.15, 0.06],
      [CAP_R - 0.15, 0.02], [CAP_R - 0.19, -0.01], [0.00, -0.01],
    ], alu(), 48);
    disc.rotation.x = Zturn; disc.castShadow = true;
    cap.add(disc);
    const discBack = lathe([
      [0.00, -0.06], [CAP_R - 0.15, -0.06],
      [CAP_R - 0.15, -0.02], [CAP_R - 0.19, 0.01], [0.00, 0.01],
    ], alu(), 48);
    discBack.rotation.x = Zturn;
    cap.add(discBack); // closed back

    // Tiny centre bearing torus + dome so each tip looks like a real bearing.
    const tor = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.022, 14, 32), M.polishedSteel());
    tor.position.z = 0;
    cap.add(tor);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 16), dark());
    dome.scale.set(1, 1, 0.6);
    cap.add(dome);

    return cap;
  }

  _ensureWhir() {
    if (!this.whir) this.whir = this.ctx.feedback.sound.tone({ type: 'sawtooth', freq: 60, gain: 0, lowpass: 900 });
  }

  onDown(hit, ndc) {
    this._ensureWhir();
    this.dragging = true;
    this.lastAngle = Math.atan2(ndc.y, ndc.x);
    this.lastT = performance.now() / 1000;
    this.vel = 0;
    // Finger near the centre = brake.
    this.braking = Math.hypot(ndc.x, ndc.y) < 0.13;
    if (this.braking && !this.scrape) {
      this.scrape = this.ctx.feedback.sound.noiseTone({ freq: 1200, q: 0.7, gain: 0 });
    }
  }

  onMove(hit, ndc) {
    if (!this.dragging) return;
    this.braking = Math.hypot(ndc.x, ndc.y) < 0.13;
    if (this.braking && !this.scrape) {
      this.scrape = this.ctx.feedback.sound.noiseTone({ freq: 1200, q: 0.7, gain: 0 });
    }
    const a = Math.atan2(ndc.y, ndc.x);
    const now = performance.now() / 1000;
    const dt = Math.max(1 / 240, now - this.lastT);
    const da = wrap(a - this.lastAngle);
    this.angle += da;          // follow the finger directly while dragging
    this.vel = da / dt;        // track release velocity
    this.lastAngle = a; this.lastT = now;
  }

  onUp() {
    if (this.dragging && !this.braking) {
      this.omega = clamp(this.vel, -95, 95); // hand off flick velocity
    }
    this.dragging = false;
    this.braking = false;
    if (this.scrape) { this.scrape.stop(); this.scrape = null; }
  }

  onLeave() {
    if (this.whir) { this.whir.stop(); this.whir = null; }
    if (this.scrape) { this.scrape.stop(); this.scrape = null; }
    this.dragging = false;
    this.braking = false;
  }

  update(dt, t) {
    if (!this.dragging) {
      // Bearing friction: small constant term + drag proportional to speed.
      const sign = Math.sign(this.omega);
      const fr = (0.22 + 0.055 * Math.abs(this.omega)) * dt;
      if (Math.abs(this.omega) <= fr) this.omega = 0;
      else this.omega -= sign * fr;
      this.angle += this.omega * dt;
    } else if (this.braking) {
      this.omega *= Math.pow(0.02, dt); // strong decay while braking
      this.angle += this.omega * dt;
    }

    this.spinner.rotation.z = this.angle;

    const rpm = Math.abs(this.omega) / (Math.PI * 2) * 60;
    if (rpm > this.maxRpm + 1) { this.maxRpm = Math.round(rpm); this.save('spin.maxrpm', this.maxRpm); }
    this.refreshStat();

    // Per-rev detent tick only at low speed; the whir takes over when fast.
    const revs = this.angle / (Math.PI * 2 / 3); // each arm passing top
    const cur = Math.floor(revs);
    if (Math.abs(this.omega) > 0.4 && Math.abs(this.omega) < 8 && cur !== this.lastRev) {
      this.ctx.feedback.emit({ type: 'detent', intensity: 0.2, pitch: 1.6 });
    }
    this.lastRev = cur;

    // Continuous bearing whir scales with speed.
    if (this.whir) {
      const s = Math.min(1, rpm / 600);
      this.whir.setFreq(70 + rpm * 0.45);
      this.whir.setGain(s * 0.12);
      if (this.whir.setLowpass) this.whir.setLowpass(900 + rpm * 1.5);
    }
    if (this.scrape) this.scrape.setGain(this.braking ? Math.min(0.18, rpm / 1500) : 0);

    // Motion ghost: a faint, slightly offset additive copy at high RPM.
    const ghostK = clamp((rpm - 120) / 700, 0, 1);
    const showGhost = ghostK > 0.02 && !this.ctx.settings.reducedMotion;
    this.ghost.visible = showGhost;
    if (showGhost) {
      this.ghost.rotation.z = this.angle + 0.5;
      this.ghost.traverse((o) => { if (o.isMesh) o.material.opacity = ghostK * 0.5; });
    }
  }

  info() {
    const rpm = Math.round(Math.abs(this.omega) / (Math.PI * 2) * 60);
    return `<span class="num">${rpm}</span>rpm · best ${this.maxRpm}`;
  }
}
