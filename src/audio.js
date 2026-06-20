// Web Audio for SWING·STACK. A swing whoosh whose pitch tracks pendulum speed
// (you hear the rhythm), a release pop, a pitched "place" that climbs with the
// tower, a bright "perfect" chime, a slice for the offcut, and a game-over thud.
export class Audio {
  constructor() { this.ctx = null; }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    this.ctx = new C();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;

    // continuous swing whoosh: looping noise through a bandpass tied to speed
    this.windBp = this.ctx.createBiquadFilter(); this.windBp.type = 'bandpass'; this.windBp.frequency.value = 500; this.windBp.Q.value = 0.9;
    this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0;
    const n = this.ctx.createBufferSource(); n.buffer = buf; n.loop = true;
    n.connect(this.windBp); this.windBp.connect(this.windGain); this.windGain.connect(this.master); n.start();
  }

  swing(speed01) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.015 + speed01 * 0.12, t, 0.06);
    this.windBp.frequency.setTargetAtTime(320 + speed01 * 1500, t, 0.06);
  }

  _tone(freq, dur, type, gain, slideTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type || 'sine';
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.frequency.setValueAtTime(freq, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  _burst(freq, dur, gain) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource(); n.buffer = this._noise;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(this.master); n.start(t); n.stop(t + dur + 0.02);
  }

  release() { this._tone(520, 0.1, 'sine', 0.12, 360); }
  place(n) { const f = 300 + Math.min(n, 40) * 16; this._tone(f, 0.15, 'triangle', 0.26, f * 1.4); }
  perfect(combo) {
    const f = 540 + Math.min(combo, 12) * 80;
    this._tone(f, 0.17, 'square', 0.2, f * 1.4); this._tone(f * 2, 0.13, 'sine', 0.12, f * 2.5);
  }
  slice() { this._burst(1600, 0.16, 0.22); }
  over() { this._burst(500, 0.4, 0.4); this._tone(180, 0.5, 'sawtooth', 0.3, 55); this.swing(0); }
}
