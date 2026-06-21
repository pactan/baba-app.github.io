// Input for the archery playground:
//  - right joystick (thumbstick) moves the on-screen aim reticle
//  - left HOLD button charges shot power; RELEASE fires
//  - tapping elsewhere on the view also nudges aim toward that point
export class Input {
  constructor() {
    this.aim = { x: 0, y: 0 };     // -1..1 joystick vector
    this.charging = false;
    this.fired = false;            // edge: true the frame the shot releases
    this.power = 0;                // 0..1 charge level (read by game)

    this._stick = document.getElementById('stick');
    this._nub = document.getElementById('stick-nub');
    this._power = document.getElementById('power-btn');
    this._stickId = null; this._stickCx = 0; this._stickCy = 0; this._R = 54;

    this._bindStick();
    this._bindPower();

    addEventListener('keydown', (e) => this._key(e, true));
    addEventListener('keyup', (e) => this._key(e, false));
  }

  _bindStick() {
    const el = this._stick; if (!el) return;
    const start = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      this._stickCx = r.left + r.width / 2; this._stickCy = r.top + r.height / 2;
      this._stickId = e.pointerId; el.setPointerCapture?.(e.pointerId);
      this._move(e);
    };
    const move = (e) => { if (e.pointerId === this._stickId) { e.preventDefault(); this._move(e); } };
    const end = (e) => {
      if (e.pointerId !== this._stickId) return;
      this._stickId = null; this.aim.x = 0; this.aim.y = 0;
      if (this._nub) this._nub.style.transform = 'translate(-50%,-50%)';
    };
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  _move(e) {
    let dx = e.clientX - this._stickCx, dy = e.clientY - this._stickCy;
    const len = Math.hypot(dx, dy);
    if (len > this._R) { dx *= this._R / len; dy *= this._R / len; }
    this.aim.x = dx / this._R; this.aim.y = dy / this._R;
    if (this._nub) this._nub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  _bindPower() {
    const el = this._power; if (!el) return;
    const down = (e) => { e.preventDefault(); this.charging = true; el.classList.add('active'); el.setPointerCapture?.(e.pointerId); };
    const up = (e) => { e.preventDefault(); if (this.charging) { this.charging = false; this.fired = true; } el.classList.remove('active'); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  _key(e, on) {
    // keyboard fallback for desktop testing
    const s = 0.9;
    if (e.key === 'ArrowLeft' || e.key === 'a') this.aim.x = on ? -s : 0;
    else if (e.key === 'ArrowRight' || e.key === 'd') this.aim.x = on ? s : 0;
    else if (e.key === 'ArrowUp' || e.key === 'w') this.aim.y = on ? -s : 0;
    else if (e.key === 'ArrowDown' || e.key === 's') this.aim.y = on ? s : 0;
    else if (e.key === ' ') {
      if (on) { this.charging = true; }
      else if (this.charging) { this.charging = false; this.fired = true; }
      e.preventDefault();
    } else return;
    e.preventDefault();
  }

  endFrame() { this.fired = false; }
}
