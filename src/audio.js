// Web Audio for the drift-cube sandbox. Loops: engine hum (pitch follows
// speed, swells on throttle) + tire screech (filtered noise, follows drift).
// One-shots: thud (walls), crash (knocking obstacles), jump, land, tumble.
// Must be started from a user gesture.
export class Audio {
  constructor() { this.ctx = null; }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = new C();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(ctx.destination);

    // engine: two detuned saws through a lowpass
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0; this.engGain.connect(this.master);
    this.engLp = ctx.createBiquadFilter(); this.engLp.type = 'lowpass'; this.engLp.frequency.value = 500;
    this.engLp.connect(this.engGain);
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth'; this.osc1.frequency.value = 55;
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'sawtooth'; this.osc2.frequency.value = 56.5;
    this.osc1.connect(this.engLp); this.osc2.connect(this.engLp);
    this.osc1.start(); this.osc2.start();

    // shared noise buffer
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;

    // screech loop
    this.scrBp = ctx.createBiquadFilter(); this.scrBp.type = 'bandpass'; this.scrBp.frequency.value = 1500; this.scrBp.Q.value = 1.2;
    this.scrGain = ctx.createGain(); this.scrGain.gain.value = 0;
    const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true;
    n.connect(this.scrBp); this.scrBp.connect(this.scrGain); this.scrGain.connect(this.master); n.start();
  }

  engine(speed01, throttle) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.osc1.frequency.setTargetAtTime(50 + speed01 * 175, t, 0.08);
    this.osc2.frequency.setTargetAtTime(51.5 + speed01 * 181, t, 0.08);
    this.engLp.frequency.setTargetAtTime(420 + speed01 * 2100 + (throttle ? 350 : 0), t, 0.1);
    this.engGain.gain.setTargetAtTime(0.04 + speed01 * 0.12 + (throttle ? 0.05 : 0), t, 0.1);
  }

  screech(amount) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.scrGain.gain.setTargetAtTime(amount * 0.22, t, 0.05);
    this.scrBp.frequency.setTargetAtTime(1200 + amount * 1500, t, 0.06);
  }

  // short filtered-noise burst (impacts)
  _burst(freq, dur, gain) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource(); n.buffer = this._noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(this.master);
    n.start(t); n.stop(t + dur + 0.02);
  }
  _blip(freq, dur, type, gain, slideTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  thud() { this._burst(300, 0.25, 0.5); this._blip(90, 0.18, 'sine', 0.3, 50); }
  crash() { this._burst(1800, 0.3, 0.45); this._blip(160, 0.2, 'square', 0.18, 70); }
  tumble() { this._burst(500, 0.55, 0.55); this._blip(140, 0.5, 'sawtooth', 0.25, 45); }
  jump() { this._blip(380, 0.16, 'square', 0.2, 720); }
  land() { this._burst(400, 0.12, 0.3); }
  bank(mult) { this._blip(480 + Math.min(mult, 9) * 60, 0.16, 'triangle', 0.22, 760 + Math.min(mult, 9) * 70); }

  hush() { this.engine(0, false); this.screech(0); }
}
