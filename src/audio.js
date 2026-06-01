// Web Audio for the wood-cube game: a low rolling rumble (constant), a friction
// screech that rises while drifting, a fire roar when ablaze, plus jump/land
// and death blips. Must be started from a user gesture.
export class Audio {
  constructor() { this.ctx = null; }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = new C();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(ctx.destination);

    // rolling rumble: low triangle through a lowpass
    this.rollGain = ctx.createGain(); this.rollGain.gain.value = 0.0; this.rollGain.connect(this.master);
    this.rollLp = ctx.createBiquadFilter(); this.rollLp.type = 'lowpass'; this.rollLp.frequency.value = 240;
    this.rollLp.connect(this.rollGain);
    this.roll = ctx.createOscillator(); this.roll.type = 'triangle'; this.roll.frequency.value = 70;
    this.roll.connect(this.rollLp); this.roll.start();

    // friction screech + fire roar: shared noise source, two filters
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.scrBp = ctx.createBiquadFilter(); this.scrBp.type = 'bandpass'; this.scrBp.frequency.value = 1500; this.scrBp.Q.value = 1.1;
    this.scrGain = ctx.createGain(); this.scrGain.gain.value = 0;
    this.noise1 = ctx.createBufferSource(); this.noise1.buffer = buf; this.noise1.loop = true;
    this.noise1.connect(this.scrBp); this.scrBp.connect(this.scrGain); this.scrGain.connect(this.master); this.noise1.start();

    this.fireLp = ctx.createBiquadFilter(); this.fireLp.type = 'lowpass'; this.fireLp.frequency.value = 700;
    this.fireGain = ctx.createGain(); this.fireGain.gain.value = 0;
    this.noise2 = ctx.createBufferSource(); this.noise2.buffer = buf; this.noise2.loop = true;
    this.noise2.connect(this.fireLp); this.fireLp.connect(this.fireGain); this.fireGain.connect(this.master); this.noise2.start();
  }

  roll01(v) { // constant rolling intensity 0..1
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.rollGain.gain.setTargetAtTime(0.06 + v * 0.10, t, 0.1);
    this.roll.frequency.setTargetAtTime(60 + v * 40, t, 0.1);
  }
  screech(amount) { // friction 0..1
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.scrGain.gain.setTargetAtTime(amount * 0.20, t, 0.05);
    this.scrBp.frequency.setTargetAtTime(1200 + amount * 1500, t, 0.06);
  }
  fire(amount) { // blaze 0..1
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.fireGain.gain.setTargetAtTime(amount * 0.28, t, 0.08);
  }

  _blip(freq, dur, type, gain, slideTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type || 'square';
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.25, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  jump() { this._blip(420, 0.18, 'square', 0.22, 760); }
  land() { this._blip(200, 0.12, 'sine', 0.2, 120); }
  ignite() { this._blip(120, 0.5, 'sawtooth', 0.25, 380); }
  death() { this._blip(300, 0.6, 'sawtooth', 0.3, 60); }
  point(mult) { this._blip(500 + Math.min(mult, 8) * 60, 0.16, 'triangle', 0.2, (700 + Math.min(mult, 8) * 80)); }

  // silence loops on game over
  hush() { this.roll01(0); this.screech(0); this.fire(0); }
}
