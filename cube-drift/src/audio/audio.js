// audio/audio.js
// Fully procedural synthwave engine (no asset files). A pulsing bass, an
// arpeggio that schedules itself ahead of time, plus one-shot SFX. Overall
// intensity follows the player's speed.

const SCALE = [0, 3, 5, 7, 10, 12, 15];   // minor pentatonic-ish

export class Audio {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.intensity = 0;        // 0..1 (driven by speed)
    this.muted = false;
  }

  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.started = true;

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(this.ctx.destination);

    // gentle master compression-ish limiter
    this.music = this.ctx.createGain();
    this.music.gain.value = 0.5;
    this.music.connect(this.master);

    this._startBass();
    this._next = this.ctx.currentTime + 0.1;
    this._step = 0;
    this._tick();
    // fade in
    this.master.gain.linearRampToValueAtTime(0.9, this.ctx.currentTime + 1.2);
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setIntensity(v) { this.intensity = Math.max(0, Math.min(1, v)); }

  _startBass() {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 55;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    const g = this.ctx.createGain();
    g.gain.value = 0.0;
    o.connect(f); f.connect(g); g.connect(this.music);
    o.start();
    this.bass = { o, g, f };
  }

  // beat-synced arpeggio + bass pulse
  _tick() {
    if (!this.ctx) return;
    const spb = 0.26 - this.intensity * 0.08;   // faster when fast
    while (this._next < this.ctx.currentTime + 0.3) {
      const t = this._next;
      const beat = this._step % 8;

      // bass pulse on each step
      const root = 55 * Math.pow(2, (beat < 4 ? 0 : 5) / 12);
      this.bass.o.frequency.setValueAtTime(root, t);
      const bg = 0.18 + this.intensity * 0.22;
      this.bass.g.gain.cancelScheduledValues(t);
      this.bass.g.gain.setValueAtTime(bg, t);
      this.bass.g.gain.exponentialRampToValueAtTime(0.02, t + spb * 0.9);
      this.bass.f.frequency.setValueAtTime(220 + this.intensity * 900, t);

      // arpeggio lead (denser at high intensity)
      if (this.intensity > 0.15 || beat % 2 === 0) {
        const n = SCALE[(this._step * 2) % SCALE.length];
        const oct = 1 + (this._step % 3 === 0 ? 1 : 0);
        this._blip(220 * Math.pow(2, (n + 12 * oct) / 12), t, spb * 0.9,
          0.05 + this.intensity * 0.09);
      }
      // shimmer on downbeats when intense
      if (beat === 0 && this.intensity > 0.4) {
        this._blip(880, t, spb * 1.6, 0.04 + this.intensity * 0.05, 'triangle');
      }

      this._next += spb;
      this._step++;
    }
    this._timer = setTimeout(() => this._tick(), 60);
  }

  _blip(freq, t, dur, vol, type = 'sawtooth') {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1200 + this.intensity * 4000;
    o.connect(f); f.connect(g); g.connect(this.music);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---- one-shot SFX --------------------------------------------------------
  pickup() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._blip(880, t, 0.12, 0.12, 'square');
    this._blip(1320, t + 0.05, 0.12, 0.1, 'square');
  }

  drift(on) {
    if (!this.ctx) return;
    if (on && !this._driftNode) {
      const buf = this._noiseBuffer();
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.8;
      const g = this.ctx.createGain(); g.gain.value = 0.0;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
      g.gain.linearRampToValueAtTime(0.12, this.ctx.currentTime + 0.05);
      this._driftNode = { src, g };
    } else if (!on && this._driftNode) {
      const { src, g } = this._driftNode;
      g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);
      src.stop(this.ctx.currentTime + 0.15);
      this._driftNode = null;
    }
  }

  crash() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(2200, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.6);
    // sub thud
    const o = this.ctx.createOscillator();
    o.type = 'sine'; o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.5, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(og); og.connect(this.master);
    o.start(t); o.stop(t + 0.5);
  }

  _noiseBuffer() {
    if (this._nb) return this._nb;
    const len = this.ctx.sampleRate * 1;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._nb = buf;
    return buf;
  }

  duck(on) {
    // slow-mo near-death "underwater" feel
    if (!this.ctx) return;
    this.music.gain.linearRampToValueAtTime(on ? 0.18 : 0.5, this.ctx.currentTime + 0.2);
  }
}
