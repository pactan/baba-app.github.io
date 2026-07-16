// engine/input.js
// Unified, low-latency input for touch / mouse / keyboard.
//   • TAP  -> instant 90° turn  (fires on pointerdown for minimum latency)
//   • HOLD -> drift mode        (engages if the pointer stays down past a threshold)
// Callbacks are plain functions set by the game.

const HOLD_MS = 140;     // press longer than this counts as a drift, not a tap
const MOVE_TOL = 24;     // px of movement still considered a tap

export class Input {
  constructor(target = window) {
    this.onTap = () => {};
    this.onDriftStart = () => {};
    this.onDriftEnd = () => {};
    this.onAnyPress = () => {};   // used by menus ("tap anywhere")

    this._down = false;
    this._drift = false;
    this._startX = 0;
    this._startY = 0;
    this._holdTimer = null;
    this.enabled = false;

    const el = target;
    // Pointer events cover touch + mouse with one code path.
    el.addEventListener('pointerdown', this._press, { passive: false });
    el.addEventListener('pointerup', this._release, { passive: false });
    el.addEventListener('pointercancel', this._release, { passive: false });
    el.addEventListener('pointermove', this._move, { passive: false });

    // Desktop keyboard niceties.
    window.addEventListener('keydown', this._key);
    window.addEventListener('keyup', this._keyUp);
  }

  _press = (e) => {
    if (e.cancelable) e.preventDefault();
    this.onAnyPress();
    if (!this.enabled || this._down) return;
    this._down = true;
    this._startX = e.clientX;
    this._startY = e.clientY;
    this.onTap();                       // instant turn
    this._holdTimer = setTimeout(() => {
      if (this._down) { this._drift = true; this.onDriftStart(); }
    }, HOLD_MS);
  };

  _move = (e) => {
    if (!this._down) return;
    const dx = Math.abs(e.clientX - this._startX);
    const dy = Math.abs(e.clientY - this._startY);
    if (dx + dy > MOVE_TOL && !this._drift) {
      // A swipe also engages drift immediately.
      clearTimeout(this._holdTimer);
      this._drift = true;
      this.onDriftStart();
    }
  };

  _release = (e) => {
    if (e && e.cancelable) e.preventDefault();
    if (!this._down) return;
    this._down = false;
    clearTimeout(this._holdTimer);
    if (this._drift) { this._drift = false; this.onDriftEnd(); }
  };

  _key = (e) => {
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'Enter') {
      this.onAnyPress();
      if (this.enabled) this.onTap();
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'ArrowDown') {
      if (this.enabled && !this._drift) { this._drift = true; this.onDriftStart(); }
    }
  };

  _keyUp = (e) => {
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'ArrowDown') && this._drift) {
      this._drift = false; this.onDriftEnd();
    }
  };

  reset() {
    this._down = false;
    clearTimeout(this._holdTimer);
    if (this._drift) { this._drift = false; this.onDriftEnd(); }
  }
}
