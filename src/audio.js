// Web Audio synthesis layer. Every event is a short layered transient:
// a high-frequency click (noise through a bandpass) + a low body (sine),
// shaped with a fast ADSR and fed through a faint convolver reverb so the
// sounds aren't bone-dry. Per-event pitch + tiny randomization avoid the
// "machine gun" effect on repeats.
//
// Real sampled WAVs beat synthesis for realism (see brief) — this layer is
// written so a sample-playback path can be slotted in later behind play().

const PRESETS = {
  // [bodyFreq, bodyDecay], [clickFreq, clickDecay], noiseAmt, gain
  'click-down': { body: [175, 0.13], click: [2700, 0.012], noise: 0.55, gain: 1.0 },
  'click-up':   { body: [150, 0.08], click: [2100, 0.008], noise: 0.30, gain: 0.5 },
  'pop-in':     { body: [430, 0.05], click: [1900, 0.018], noise: 0.45, gain: 0.8 },
  'pop-out':    { body: [250, 0.09], click: [1150, 0.022], noise: 0.30, gain: 0.6 },
  'detent':     { body: [320, 0.04], click: [3100, 0.008], noise: 0.6,  gain: 0.55 },
  'thud':       { body: [110, 0.18], click: [800,  0.02],  noise: 0.25, gain: 0.9 },
};

export class Sound {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
  }

  // Must be called from a user gesture (iOS unlock requirement).
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.settings.volume;
    this.master.connect(ctx.destination);

    // Dry path + a low reverb send for a faint sense of room.
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.9;
    this.dry.connect(this.master);

    const convolver = ctx.createConvolver();
    convolver.buffer = this._makeImpulse(0.28, 2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.18;
    this.send = ctx.createGain();
    this.send.gain.value = 1;
    this.send.connect(convolver);
    convolver.connect(wet);
    wet.connect(this.master);

    this.noiseBuf = this._makeNoise(0.3);
  }

  setVolume(v) {
    if (this.master) this.master.gain.value = v;
  }

  play(type, opts = {}) {
    this.ensure();
    if (!this.ctx) return;
    const p = PRESETS[type] || PRESETS.detent;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const pitch = (opts.pitch || 1) * (0.99 + Math.random() * 0.02);
    const intensity = opts.intensity == null ? 1 : opts.intensity;

    const out = ctx.createGain();
    out.gain.value = p.gain * (0.55 + 0.45 * intensity);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = Math.max(-1, Math.min(1, opts.pan || 0));
      out.connect(pan); pan.connect(this.dry); pan.connect(this.send);
    } else {
      out.connect(this.dry); out.connect(this.send);
    }

    // Low body — gives the hit weight.
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(p.body[0] * pitch * 1.4, t);
    o.frequency.exponentialRampToValueAtTime(p.body[0] * pitch, t + p.body[1] * 0.6);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(1, t + 0.002);
    og.gain.exponentialRampToValueAtTime(0.0001, t + p.body[1]);
    o.connect(og); og.connect(out);
    o.start(t); o.stop(t + p.body[1] + 0.02);

    // High click — the crisp transient.
    if (p.noise > 0 && this.noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = p.click[0] * pitch;
      bp.Q.value = 0.9;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(p.noise, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + p.click[1]);
      src.connect(bp); bp.connect(ng); ng.connect(out);
      src.start(t); src.stop(t + p.click[1] + 0.02);
    }
  }

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }
}
