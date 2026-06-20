// One-tap input for STACK. Any press anywhere = "drop". Edge-triggered.
export class Input {
  constructor() {
    this.tapped = false;
    const fire = (e) => {
      // ignore taps on the restart button (it has its own handler)
      if (e.target && e.target.id === 'btn-again') return;
      this.tapped = true;
    };
    addEventListener('pointerdown', fire);
    addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp') { this.tapped = true; e.preventDefault(); }
    });
  }
  endFrame() { this.tapped = false; }
}
