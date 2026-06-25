// One-button input for STICK!: HOLD does everything (wind up on the ground, tuck
// in the air). Exposes: held (continuous), pressed (edge down), released (edge up).
// The game reads pressed/held/released, then calls endFrame() once per frame.
export class Input {
  constructor() {
    this.held = false; this._was = false;
    const down = (e) => { if (e.target && e.target.id === 'btn-again') return; this.held = true; };
    const up = () => { this.held = false; };
    addEventListener('pointerdown', down);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'Enter') { this.held = true; e.preventDefault(); } });
    addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'Enter') { this.held = false; e.preventDefault(); } });
  }
  get pressed() { return this.held && !this._was; }    // rising edge this frame
  get released() { return !this.held && this._was; }   // falling edge this frame
  endFrame() { this._was = this.held; }                // call once per frame after reading
}
