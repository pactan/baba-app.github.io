// game/game.js
// Pure game state: score, best, the speed curve and the difficulty ramp.

export const STATE = { MENU: 0, PLAYING: 1, DYING: 2, DEAD: 3 };

const START_SPEED = 7.5;
const MAX_SPEED = 23;
const RAMP_SECONDS = 80;     // time to reach full difficulty

export class GameState {
  constructor() {
    this.best = parseInt(localStorage.getItem('cubedrift.best') || '0', 10) || 0;
    this.state = STATE.MENU;
    this.reset();
  }

  reset() {
    this.score = 0;
    this.bonus = 0;        // shard pickups, kept separate from distance score
    this.distance = 0;
    this.time = 0;
    this.speed = START_SPEED;
  }

  /** 0..1 difficulty, eased so the opening is calm. */
  difficulty() {
    const x = Math.min(1, this.time / RAMP_SECONDS);
    return x * x * (3 - 2 * x);     // smoothstep
  }

  speedTarget() {
    return START_SPEED + (MAX_SPEED - START_SPEED) * this.difficulty();
  }

  /** 0..1 used for FOV / bloom / audio reactivity. */
  speed01() {
    return (this.speed - START_SPEED) / (MAX_SPEED - START_SPEED);
  }

  saveBest() {
    if (this.score > this.best) {
      this.best = this.score;
      try { localStorage.setItem('cubedrift.best', String(this.best)); } catch {}
      return true;
    }
    return false;
  }
}
