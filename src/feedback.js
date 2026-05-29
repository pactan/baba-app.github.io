import { Sound } from './audio.js';

// Per-event haptic "weight" in milliseconds (or patterns). Scaled by intensity.
// Web vibration is Android-only; iOS Safari ignores it. The bus is structured
// so this haptic channel can later be swapped for a native (Capacitor) call.
const HAPTIC = {
  'click-down': 18,
  'click-up': 8,
  'pop-in': 14,
  'pop-out': 9,
  'detent': 10,
  'thud': [22],
};

export class Feedback {
  constructor(settings) {
    this.settings = settings;
    this.sound = new Sound(settings);
  }

  // Call from a user gesture to unlock audio (iOS).
  unlock() { this.sound.ensure(); }

  // The single entry point. Every fidget emits discrete events here; all three
  // channels fire on the same frame. `visual` is an optional callback the
  // station passes so its flash/ripple is triggered in lockstep with sound.
  emit(ev) {
    this.sound.play(ev.type, ev);
    this._haptic(ev.type, ev.intensity == null ? 1 : ev.intensity);
    if (ev.visual) ev.visual();
  }

  _haptic(type, intensity) {
    if (!this.settings.haptics) return;
    if (!navigator.vibrate) return;
    const base = HAPTIC[type] ?? 12;
    if (Array.isArray(base)) {
      navigator.vibrate(base.map((n) => Math.max(1, Math.round(n * (0.6 + intensity)))));
    } else {
      navigator.vibrate(Math.max(1, Math.round(base * (0.5 + intensity))));
    }
  }
}

export const hapticsSupported = typeof navigator !== 'undefined' && !!navigator.vibrate;
