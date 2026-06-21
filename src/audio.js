// Web Audio for the archery playground: a bow-draw tone that rises with charge,
// a release twang, and distinct impacts (soft thud body, sharp crack on head KO).
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

    // continuous bow-draw drone (silent until charging)
    this.drawOsc = this.ctx.createOscillator(); this.drawOsc.type = 'sawtooth'; this.drawOsc.frequency.value = 90;
    this.drawLp = this.ctx.createBiquadFilter(); this.drawLp.type = 'lowpass'; this.drawLp.frequency.value = 300;
    this.drawGain = this.ctx.createGain(); this.drawGain.gain.value = 0;
    this.drawOsc.connect(this.drawLp); this.drawLp.connect(this.drawGain); this.drawGain.connect(this.master);
    this.drawOsc.start();
  }

  draw(power01) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.drawGain.gain.setTargetAtTime(power01 > 0 ? 0.05 + power01 * 0.08 : 0, t, 0.04);
    this.drawOsc.frequency.setTargetAtTime(80 + power01 * 220, t, 0.04);
    this.drawLp.frequency.setTargetAtTime(250 + power01 * 900, t, 0.04);
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

  release(power01) { this.draw(0); this._tone(420 + power01 * 260, 0.12, 'triangle', 0.18, 180); this._burst(2200, 0.06, 0.12); }
  hitBody(power01) { this._burst(360, 0.18, 0.3); this._tone(150, 0.16, 'sine', 0.2, 80); }
  hitHead() { this._burst(2600, 0.12, 0.35); this._tone(300, 0.2, 'square', 0.22, 90); }
  ko() { this._tone(260, 0.5, 'sawtooth', 0.25, 50); }
  win() { this._tone(520, 0.14, 'triangle', 0.2, 660); setTimeout(() => this._tone(700, 0.2, 'triangle', 0.2, 900), 120); }
}
