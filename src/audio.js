// Web Audio for STACK: a pitched "place" tick that climbs with each block, a
// brighter "perfect" chime, a slice/chop for the falling offcut, and a game-over
// thud. Must be started from a user gesture.
export class Audio {
  constructor() { this.ctx = null; this.combo = 0; }

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

  // a normal placement: pitch climbs as the tower grows, resets on miss
  place(n) {
    const base = 300 + Math.min(n, 40) * 18;
    this._tone(base, 0.16, 'triangle', 0.28, base * 1.5);
    this.combo = 0;
  }
  // a perfect placement: brighter, and climbs with the perfect-combo
  perfect(comboLevel) {
    const f = 520 + Math.min(comboLevel, 12) * 90;
    this._tone(f, 0.18, 'square', 0.22, f * 1.4);
    this._tone(f * 2, 0.14, 'sine', 0.14, f * 2.6);
  }
  slice() { this._noiseBurst(1600, 0.18, 0.25); }
  over() { this._noiseBurst(500, 0.4, 0.4); this._tone(180, 0.5, 'sawtooth', 0.3, 60); }
}
