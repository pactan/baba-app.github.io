// Lightweight Web Audio: a continuous engine tone (pitch ∝ speed), a tire
// screech (filtered noise while drifting), and a short "bank" chime when a
// combo is cashed in. Must be started from a user gesture (the start tap).
export class Audio {
  constructor() { this.ctx = null; }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = new C();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.6; this.master.connect(ctx.destination);

    // Engine: two detuned saws through a lowpass.
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0.0; this.engGain.connect(this.master);
    this.engLp = ctx.createBiquadFilter(); this.engLp.type = 'lowpass'; this.engLp.frequency.value = 600;
    this.engLp.connect(this.engGain);
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth'; this.osc1.frequency.value = 60;
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'sawtooth'; this.osc2.frequency.value = 61.5;
    this.osc1.connect(this.engLp); this.osc2.connect(this.engLp);
    this.osc1.start(); this.osc2.start();

    // Screech: looping white noise through a bandpass.
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource(); this.noise.buffer = buf; this.noise.loop = true;
    this.scrBp = ctx.createBiquadFilter(); this.scrBp.type = 'bandpass'; this.scrBp.frequency.value = 1600; this.scrBp.Q.value = 1.2;
    this.scrGain = ctx.createGain(); this.scrGain.gain.value = 0;
    this.noise.connect(this.scrBp); this.scrBp.connect(this.scrGain); this.scrGain.connect(this.master);
    this.noise.start();
  }

  // speed01: 0..1, throttle bool
  engine(speed01) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.osc1.frequency.setTargetAtTime(55 + speed01 * 190, t, 0.08);
    this.osc2.frequency.setTargetAtTime(56.5 + speed01 * 196, t, 0.08);
    this.engLp.frequency.setTargetAtTime(500 + speed01 * 2200, t, 0.1);
    this.engGain.gain.setTargetAtTime(0.05 + speed01 * 0.14, t, 0.1);
  }

  screech(amount) { // 0..1
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.scrGain.gain.setTargetAtTime(amount * 0.22, t, 0.05);
    this.scrBp.frequency.setTargetAtTime(1300 + amount * 1400, t, 0.06);
  }

  bank(mult) { // a short rising chime, brighter with the multiplier
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'triangle';
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    const base = 440 + Math.min(mult, 8) * 70;
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.18);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.4);
  }
}
