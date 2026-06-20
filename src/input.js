// Input for NERVE: TAP anywhere = HOP (push your luck). BANK button = cash out.
// Both edge-triggered (one action per press).
export class Input {
  constructor() {
    this.hop = false;
    this.bank = false;

    addEventListener('pointerdown', (e) => {
      const t = e.target;
      if (t && (t.id === 'btn-again')) return;          // retry handles itself
      if (t && (t.id === 'btn-bank')) { this.bank = true; return; }
      this.hop = true;                                   // tap anywhere else = hop
    });
    addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'Enter') { this.hop = true; e.preventDefault(); }
      if (e.key === 'b' || e.key === 'B' || e.key === 'ArrowDown') { this.bank = true; e.preventDefault(); }
    });
  }
  endFrame() { this.hop = false; this.bank = false; }
}
