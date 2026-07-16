// ui/hud.js
// All DOM glue: score / speed readout, the start menu and the wipeout screen.

export class HUD {
  constructor() {
    this.hud = document.getElementById('hud');
    this.menu = document.getElementById('menu');
    this.gameover = document.getElementById('gameover');
    this.scoreEl = document.getElementById('score');
    this.speedEl = document.getElementById('speed');
    this.flash = document.getElementById('flash');

    this.menuBest = document.getElementById('menu-best');
    this.goScore = document.getElementById('go-score');
    this.goBest = document.getElementById('go-best');
    this.goBestLabel = document.getElementById('go-best-label');

    this._score = -1;
    this._speed = -1;
  }

  showMenu(best) {
    this.menu.classList.remove('hidden');
    this.gameover.classList.add('hidden');
    this.hud.classList.add('hidden');
    this.menuBest.textContent = best;
  }

  showGame() {
    this.menu.classList.add('hidden');
    this.gameover.classList.add('hidden');
    this.hud.classList.remove('hidden');
  }

  showGameOver(score, best, isNew) {
    this.gameover.classList.remove('hidden');
    this.hud.classList.add('hidden');
    this.goScore.textContent = score;
    this.goBest.textContent = best;
    this.goBestLabel.textContent = isNew ? 'NEW BEST' : 'BEST';
  }

  setScore(v) {
    if (v !== this._score) { this._score = v; this.scoreEl.textContent = v; }
  }

  setSpeed(kmh) {
    const r = Math.round(kmh);
    if (r !== this._speed) {
      this._speed = r;
      this.speedEl.firstChild.textContent = r + ' ';
    }
  }

  popScore() {
    this.scoreEl.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
      { duration: 180, easing: 'ease-out' });
  }

  hit(color = 'magenta') {
    this.flash.style.background =
      color === 'cyan'
        ? 'radial-gradient(120% 100% at 50% 50%, transparent 40%, rgba(24,240,255,.45))'
        : 'radial-gradient(120% 100% at 50% 50%, transparent 40%, rgba(255,43,214,.5))';
    this.flash.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => this.flash.classList.remove('on')));
  }
}
