// Web Audio for SWING: a whoosh whose pitch tracks your speed (you HEAR your
// momentum), a clean "click" when a rope attaches, a soft release pop, a chime
// on a far landing, and a crash. Started on a gesture.
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

    // continuous wind/whoosh: looping noise through a bandpass that rises w/ speed
    this.windBp = this.ctx.createBiquadFilter(); this.windBp.type = 'bandpass'; this.windBp.frequency.value = 500; this.windBp.Q.value = 0.8;
    this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0;
    const n = this.ctx.createBufferSource(); n.buffer = buf; n.loop = true;
    n.connect(this.windBp); this.windBp.connect(this.windGain); this.windGain.connect(this.master); n.start();
  }

  wind(speed01) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.02 + speed01 * 0.16, t, 0.08);
    this.windBp.frequency.setTargetAtTime(300 + speed01 * 1700, t, 0.08);
  }

  _tone(freq, dur, type, gain, slideTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type || 'sine';
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
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

  grab() { this._tone(680, 0.08, 'square', 0.16, 880); }
  release() { this._tone(520, 0.1, 'sine', 0.12, 360); }
  land(combo) { const f = 500 + Math.min(combo, 15) * 50; this._tone(f, 0.14, 'triangle', 0.22, f * 1.5); }
  crash() { this._burst(700, 0.4, 0.45); this._tone(200, 0.5, 'sawtooth', 0.3, 55); this.wind(0); }
}
