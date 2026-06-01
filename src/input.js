// Unified input for the platform-drift game: steer left/right + jump.
// On-screen buttons (touch) and keyboard (desktop testing).
export class Input {
  constructor() {
    this.left = false;
    this.right = false;
    this.jump = false;       // edge-triggered: true for one frame on press
    this._jumpHeld = false;

    const L = document.getElementById('btn-left');
    const R = document.getElementById('btn-right');
    const J = document.getElementById('btn-jump');

    this._hold(L, (on) => { this.left = on; L.classList.toggle('active', on); });
    this._hold(R, (on) => { this.right = on; R.classList.toggle('active', on); });
    this._hold(J, (on) => { this._setJump(on); J.classList.toggle('active', on); });

    addEventListener('keydown', (e) => this._key(e, true));
    addEventListener('keyup', (e) => this._key(e, false));
  }

  _hold(el, set) {
    if (!el) return;
    const down = (e) => { e.preventDefault(); set(true); el.setPointerCapture?.(e.pointerId); };
    const up = (e) => { e.preventDefault(); set(false); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') set(false); });
  }

  _setJump(on) {
    if (on && !this._jumpHeld) this.jump = true; // rising edge
    this._jumpHeld = on;
  }

  _key(e, on) {
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': this.left = on; break;
      case 'ArrowRight': case 'd': case 'D': this.right = on; break;
      case ' ': case 'ArrowUp': case 'w': case 'W': this._setJump(on); break;
      default: return;
    }
    e.preventDefault();
  }

  // call once per frame after reading, to clear the one-shot jump
  endFrame() { this.jump = false; }

  get steer() { return (this.right ? 1 : 0) - (this.left ? 1 : 0); }
}
