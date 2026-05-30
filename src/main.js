import { Game } from './game.js';
import { Input } from './input.js';
import { Audio } from './audio.js';

const $ = (id) => document.getElementById(id);

let lastScore = -1, lastBest = -1, lastCombo = '';
const hud = {
  setScore(v) { if (v !== lastScore) { lastScore = v; $('score').textContent = v.toLocaleString(); } },
  setBest(v) { if (v !== lastBest) { lastBest = v; $('best').textContent = v.toLocaleString(); } },
  setCombo(mult, pending, on) {
    const el = $('combo');
    el.classList.toggle('on', on);
    const key = on ? mult + '|' + pending : 'off';
    if (key !== lastCombo) {
      lastCombo = key;
      if (on) { $('combo-mult').textContent = 'x' + mult; $('combo-pending').textContent = '+' + pending; }
    }
  },
  bankFlash() {
    const el = $('combo');
    el.classList.add('bank');
    setTimeout(() => el.classList.remove('bank'), 420);
  },
};

const audio = new Audio();
const input = new Input();
const game = new Game($('scene'), audio, input, hud);

// Start on first tap (also unlocks audio on iOS).
const startEl = $('start');
const begin = () => {
  audio.start();
  startEl.classList.add('hidden');
  game.start();
};
startEl.addEventListener('pointerdown', begin, { once: true });
