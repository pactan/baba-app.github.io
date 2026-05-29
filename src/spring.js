// Critically-tunable spring used for every press / travel / settle in the app.
// Semi-implicit Euler integration: stable and cheap.
export class Spring {
  constructor(stiffness = 170, damping = 18, value = 0) {
    this.k = stiffness;
    this.d = damping;
    this.value = value;
    this.target = value;
    this.v = 0;
  }

  set(target) { this.target = target; return this; }

  // Hard jump, no animation.
  snap(value) { this.value = value; this.target = value; this.v = 0; return this; }

  update(dt) {
    dt = Math.min(dt, 1 / 30); // clamp big frame gaps so the sim never explodes
    const a = -this.k * (this.value - this.target) - this.d * this.v;
    this.v += a * dt;
    this.value += this.v * dt;
    return this.value;
  }

  get atRest() {
    return Math.abs(this.v) < 0.001 && Math.abs(this.value - this.target) < 0.001;
  }
}
