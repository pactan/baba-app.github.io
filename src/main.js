import { Game } from './game.js?v=11';
import { Input } from './input.js?v=11';
import { Audio } from './audio.js?v=11';

const $ = (id) => document.getElementById(id);

let lastScore = -1, lastBest = -1, lastCombo = '', lastHeat = -1;
const hud = {
  setScore(v) { if (v !== lastScore) { lastScore = v; $('score').textContent = v.toLocaleString(); } },
  setBest(v) { if (v !== lastBest) { lastBest = v; $('best').textContent = v.toLocaleString(); } },
  setHeat(v) {
    const pct = Math.round(v * 100);
    if (pct !== lastHeat) {
      lastHeat = pct;
      $('heatfill').style.width = pct + '%';
      const bar = $('heatbar');
      bar.classList.toggle('hot', v > 0.7);
      bar.classList.toggle('warn', v > 0.35 && v <= 0.7);
    }
  },
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
  showResult(score, best, isRecord, kind) {
    $('result-score').textContent = score.toLocaleString();
    $('result-best').textContent = 'Best ' + best.toLocaleString();
    const badge = $('result-badge');
    const label = kind === 'burn' ? 'BURNED UP 🔥' : kind === 'fall' ? 'FELL IN A GAP' : 'WIPEOUT';
    badge.textContent = isRecord ? 'NEW RECORD' : label;
    badge.classList.toggle('record', isRecord);
    $('result').classList.remove('hidden');
  },
  hideResult() { $('result').classList.add('hidden'); },
};

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
  try { audio.start(); } catch (e) {}
  try {
    game = new Game($('scene'), audio, input, hud);
    game.onError = showError;
    document.body.classList.add('playing');
    $('start').classList.add('hidden');
    game.start();
  } catch (e) { started = false; showError(e); }
}

const startEl = $('start');
startEl.addEventListener('pointerdown', begin);
startEl.addEventListener('click', begin);
addEventListener('keydown', (e) => { if ((e.key === 'Enter') && !started) begin(); });

$('btn-again').addEventListener('pointerdown', (e) => { e.preventDefault(); if (game) game.restart(); });
