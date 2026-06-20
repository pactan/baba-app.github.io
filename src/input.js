// One-tap input for SWING·STACK. The block swings on a rope by itself; a single
// TAP releases it to drop onto the tower. That's the whole game.
export class Input {
  constructor() {
    this.tapped = false;
    const fire = (e) => {
      if (e.target && e.target.id === 'btn-again') return; // retry handles itself
      this.tapped = true;
    };
    addEventListener('pointerdown', fire);
    addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp') { this.tapped = true; e.preventDefault(); }
    });
  }
  endFrame() { this.tapped = false; }
}
