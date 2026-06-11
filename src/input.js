// Input for the drift-cube sandbox: gas, brake, steer left/right, jump.
// On-screen buttons (touch) + keyboard (desktop).
export class Input {
  constructor() {
    this.gas = false;
    this.brake = false;
    this.left = false;
    this.right = false;
    this.jump = false;       // edge-triggered: true for one frame on press
    this._jumpHeld = false;

    this._hold('btn-left', (on) => { this.left = on; });
    this._hold('btn-right', (on) => { this.right = on; });
    this._hold('btn-gas', (on) => { this.gas = on; });
    this._hold('btn-brake', (on) => { this.brake = on; });
    this._hold('btn-jump', (on) => this._setJump(on));

    addEventListener('keydown', (e) => this._key(e, true));
    addEventListener('keyup', (e) => this._key(e, false));
  }

  _hold(id, set) {
    const el = document.getElementById(id);
    if (!el) return;
    const wrap = (on) => { set(on); el.classList.toggle('active', on); };
    const down = (e) => { e.preventDefault(); wrap(true); el.setPointerCapture?.(e.pointerId); };
    const up = (e) => { e.preventDefault(); wrap(false); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') wrap(false); });
  }

  _setJump(on) {
    if (on && !this._jumpHeld) this.jump = true; // rising edge
    this._jumpHeld = on;
  }

  _key(e, on) {
    switch (e.key) {
      case 'ArrowUp': case 'w': case 'W': this.gas = on; break;
      case 'ArrowDown': case 's': case 'S': this.brake = on; break;
      case 'ArrowLeft': case 'a': case 'A': this.left = on; break;
      case 'ArrowRight': case 'd': case 'D': this.right = on; break;
      case ' ': this._setJump(on); break;
      default: return;
    }
    e.preventDefault();
  }

  endFrame() { this.jump = false; }

  get steer() { return (this.right ? 1 : 0) - (this.left ? 1 : 0); }
}
