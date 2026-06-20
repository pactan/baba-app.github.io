// Web Audio for FLUX: a colour-cycle blip, a satisfying gate-pass chime that
// rises with the combo, a near-miss whoosh, and a crash. Started on a gesture.
export class Audio {
  constructor() { this.ctx = null; }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    this.ctx = new C();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
  }

  _tone(freq, dur, type, gain, slideTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type || 'sine';
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  _noiseBurst(freq, dur, gain) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource(); n.buffer = this._noise;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(this.master); n.start(t); n.stop(t + dur + 0.02);
  }

  cycle() { this._tone(420, 0.07, 'square', 0.12, 520); }
  pass(combo) {
    const f = 440 + Math.min(combo, 20) * 45;
    this._tone(f, 0.13, 'triangle', 0.22, f * 1.5);
  }
  perfect(combo) {           // a clean centre pass
    const f = 600 + Math.min(combo, 20) * 55;
    this._tone(f, 0.16, 'square', 0.18, f * 1.6);
    this._tone(f * 2, 0.12, 'sine', 0.1, f * 2.4);
  }
  crash() { this._noiseBurst(700, 0.4, 0.45); this._tone(200, 0.5, 'sawtooth', 0.32, 55); }
}
