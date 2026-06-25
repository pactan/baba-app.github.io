// Web Audio for STICK!: a rising wind-up tone, a launch thwack, an airy tuck
// whoosh, a bright multi-note STICK chime that climbs with the combo, a comedy
// flop, and a result fanfare. Started from a user gesture.
export class Audio {
  constructor() { this.ctx = null; }
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    this.ctx = new C();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this._noise = buf;
    // wind-up drone
    this.windOsc = this.ctx.createOscillator(); this.windOsc.type = 'sawtooth'; this.windOsc.frequency.value = 120;
    this.windLp = this.ctx.createBiquadFilter(); this.windLp.type = 'lowpass'; this.windLp.frequency.value = 400;
    this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0;
    this.windOsc.connect(this.windLp); this.windLp.connect(this.windGain); this.windGain.connect(this.master); this.windOsc.start();
    // tuck whoosh (filtered noise)
    this.tuckBp = this.ctx.createBiquadFilter(); this.tuckBp.type = 'bandpass'; this.tuckBp.frequency.value = 900; this.tuckBp.Q.value = 0.7;
    this.tuckGain = this.ctx.createGain(); this.tuckGain.gain.value = 0;
    const n = this.ctx.createBufferSource(); n.buffer = buf; n.loop = true; n.connect(this.tuckBp); this.tuckBp.connect(this.tuckGain); this.tuckGain.connect(this.master); n.start();
  }
  wind(p) { if (!this.ctx) return; const t = this.ctx.currentTime; this.windGain.gain.setTargetAtTime(p > 0 ? 0.05 + p * 0.06 : 0, t, 0.04); this.windOsc.frequency.setTargetAtTime(120 + p * 340, t, 0.04); this.windLp.frequency.setTargetAtTime(400 + p * 1400, t, 0.04); }
  tuck(on) { if (!this.ctx) return; const t = this.ctx.currentTime; this.tuckGain.gain.setTargetAtTime(on ? 0.12 : 0, t, 0.05); }
  _tone(f, dur, type, gain, slideTo, when = 0) {
    if (!this.ctx) return; const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(); o.type = type || 'sine'; const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.frequency.setValueAtTime(f, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  _burst(f, dur, gain) { if (!this.ctx) return; const t = this.ctx.currentTime; const n = this.ctx.createBufferSource(); n.buffer = this._noise; const fl = this.ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = f; const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); n.connect(fl); fl.connect(g); g.connect(this.master); n.start(t); n.stop(t + dur + 0.02); }
  launch() { this.wind(0); this._tone(300, 0.16, 'triangle', 0.22, 760); this._burst(1800, 0.08, 0.18); }
  stick(combo) { const base = 520 + Math.min(combo, 10) * 50; this._tone(base, 0.12, 'triangle', 0.22, base * 1.3); this._tone(base * 1.5, 0.16, 'sine', 0.16, base * 1.6, 0.05); this._tone(base * 2, 0.18, 'sine', 0.1, base * 2.2, 0.1); }
  flop() { this.tuck(0); this._burst(500, 0.3, 0.4); this._tone(220, 0.45, 'sawtooth', 0.26, 55); }
  fanfare() { [0, 0.1, 0.2].forEach((w, i) => this._tone(440 + i * 160, 0.2, 'triangle', 0.2, 560 + i * 160, w)); }
}
