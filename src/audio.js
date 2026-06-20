// Web Audio for NERVE. The pitch RISES with every hop in a streak (tension
// you can hear), a fat satisfying chime when you BANK, and a buzzer on bust.
export class Audio {
  constructor() { this.ctx = null; }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    this.ctx = new C();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.6, this.ctx.sampleRate);
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

  // each hop in a streak is a step up a scale — the audible "tightening rope"
  hop(streak) {
    const semis = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];
    const s = semis[Math.min(streak, semis.length - 1)];
    const f = 300 * Math.pow(2, s / 12);
    this._tone(f, 0.12, 'triangle', 0.22, f * 1.02);
  }
  // banking: a warm two-note resolve, brighter the bigger the haul
  bank(streak) {
    const base = 360 + Math.min(streak, 18) * 22;
    this._tone(base, 0.18, 'sine', 0.26, base);
    this._tone(base * 1.5, 0.3, 'triangle', 0.2, base * 1.5);
    this._tone(base * 2, 0.34, 'sine', 0.14, base * 2);
  }
  bust() { this._noiseBurst(900, 0.45, 0.5); this._tone(220, 0.5, 'sawtooth', 0.3, 60); }
  near() { this._tone(1200, 0.06, 'square', 0.10, 1500); } // tiny tick on a risky hop
}
