import * as THREE from 'three';

// A fidget "station": a single tactile object plus its interaction logic.
// Subclasses fill build()/update() and the pointer hooks, and emit discrete
// events through ctx.feedback.emit(...).
export class Station {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.interactive = []; // meshes the raycaster tests for this station
  }

  get title() { return 'Fidget'; }
  get index() { return '00'; }
  info() { return ''; } // right-aligned HUD stat (HTML allowed)

  build() {}
  update(dt, t) {}

  // Pointer hooks. `hit` is the THREE intersection (or null), `ndc` the
  // normalized pointer coords.
  onDown(hit, ndc) {}
  onMove(hit, ndc) {}
  onUp(ndc) {}

  // --- persistence helpers ---
  load(key, fallback) {
    try {
      const v = localStorage.getItem('fidget.' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  }
  save(key, value) {
    try { localStorage.setItem('fidget.' + key, JSON.stringify(value)); } catch {}
  }

  refreshStat() { this.ctx.hud?.setStat(this.info()); }
}
