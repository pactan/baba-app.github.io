import { Game } from './game.js?v=4';
import { Input } from './input.js?v=4';
import { Audio } from './audio.js?v=4';

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

// Any failure is shown on the start overlay so it's visible (helps debugging
// from a screenshot) instead of silently doing nothing.
function showError(e) {
  const s = $('start'); s.classList.remove('hidden');
  $('err').textContent = 'Error: ' + (e && (e.message || e)) + (e && e.stack ? '\n' + e.stack.split('\n').slice(0, 3).join('\n') : '');
}
addEventListener('error', (ev) => showError(ev.error || ev.message));
addEventListener('unhandledrejection', (ev) => showError(ev.reason));

let audio, input, game, started = false;
try {
  audio = new Audio();
  input = new Input();
} catch (e) { showError(e); }

function begin() {
  if (started) return;
  started = true;
  try { audio.start(); } catch (e) { /* audio is optional */ }
  try {
    game = new Game($('scene'), audio, input, hud);   // build the heavy WebGL bits on the gesture
    game.onError = showError;
    document.body.classList.add('playing');
    $('start').classList.add('hidden');
    game.start();
  } catch (e) {
    started = false;
    showError(e);
  }
}

// Start on any first interaction (covers iOS pointer quirks).
const startEl = $('start');
startEl.addEventListener('pointerdown', begin);
startEl.addEventListener('click', begin);
addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') begin(); });
