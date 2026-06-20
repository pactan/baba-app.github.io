// One-button input for SWING. HOLD anywhere = fire/keep the rope (swing).
// RELEASE = let go and fly. That's the whole game.
export class Input {
  constructor() {
    this.held = false;
    const down = (e) => {
      if (e.target && e.target.id === 'btn-again') return; // retry handles itself
      this.held = true;
    };
    const up = () => { this.held = false; };
    addEventListener('pointerdown', down);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'ArrowUp') { this.held = true; e.preventDefault(); } });
    addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'ArrowUp') { this.held = false; e.preventDefault(); } });
  }
}
