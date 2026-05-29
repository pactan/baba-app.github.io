import * as THREE from 'three';

// A fidget "station": a single tactile object plus its interaction logic.
// Subclasses fill build()/update() and the pointer hooks, and emit discrete
// events through ctx.feedback.emit(...).
export class Station {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.interactive = []; // meshes the raycaster tests for this station
    this.isCurrent = false; // set by the Stage; only the current station owns the HUD
  }

  get title() { return 'Fidget'; }
  get index() { return '00'; }
  info() { return ''; } // right-aligned HUD stat (HTML allowed)

  // Bounding frame the camera fits to: { y: vertical center, halfW, halfH }.
  // halfW/halfH are the max extents of the content from the station's x=0 / from y.
  // The camera zooms out until this box fits the screen, so every toy stays in
  // frame on any aspect ratio (portrait phone included).
  frame() { return { y: 1.0, halfW: 2.5, halfH: 1.6 }; }

  build() {}
  update(dt, t) {}

  // Lifecycle: called when this station becomes / stops being the current one.
  // Used to free continuous audio voices etc.
  onEnter() {}
  onLeave() {}

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

  // Only the current station may write the HUD — adjacent stations still run
  // update() for their animation, but must not clobber the active toy's stat.
  refreshStat() { if (this.isCurrent) this.ctx.hud?.setStat(this.info()); }
}
