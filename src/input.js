// One-tap input for FLUX. Any press = "cycle my colour". Edge-triggered.
export class Input {
  constructor() {
    this.tapped = false;
    const fire = (e) => {
      if (e.target && e.target.id === 'btn-again') return; // retry has its own handler
      this.tapped = true;
    };
    addEventListener('pointerdown', fire);
    addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp') { this.tapped = true; e.preventDefault(); }
    });
  }
  endFrame() { this.tapped = false; }
}
