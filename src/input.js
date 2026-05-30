// Unified input: on-screen buttons (touch) + keyboard (desktop testing).
// Exposes a steady state the game samples each frame.
export class Input {
  constructor() {
    this.left = false;
    this.right = false;
    this.drift = false;

    const L = document.getElementById('btn-left');
    const R = document.getElementById('btn-right');
    const D = document.getElementById('btn-drift');

    this._hold(L, (on) => { this.left = on; L.classList.toggle('active', on); });
    this._hold(R, (on) => { this.right = on; R.classList.toggle('active', on); });
    this._hold(D, (on) => { this.drift = on; D.classList.toggle('active', on); });

    addEventListener('keydown', (e) => this._key(e, true));
    addEventListener('keyup', (e) => this._key(e, false));
  }

  // Pointer-based press/hold that survives finger sliding off the button.
  _hold(el, set) {
    const down = (e) => { e.preventDefault(); set(true); el.setPointerCapture?.(e.pointerId); };
    const up = (e) => { e.preventDefault(); set(false); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') set(false); });
  }

  _key(e, on) {
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': this.left = on; break;
      case 'ArrowRight': case 'd': case 'D': this.right = on; break;
      case ' ': case 'Shift': this.drift = on; break;
      default: return;
    }
    e.preventDefault();
  }

  // steering axis: -1 (left) .. +1 (right)
  get steer() { return (this.right ? 1 : 0) - (this.left ? 1 : 0); }
}
