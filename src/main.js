import { Game } from './game.js?v=21';
import { Input } from './input.js?v=21';
import { Audio } from './audio.js?v=21';

const $ = (id) => document.getElementById(id);

let lastShots = -1, lastBest = -1, lastPow = -1, lastLevel = '', lastGoal = '';
const hud = {
  setShots(v) { if (v !== lastShots) { lastShots = v; $('shots').textContent = v; } },
  setBest(v) { if (v !== lastBest) { lastBest = v; } },
  setPower(v) {
    const pct = Math.round(v * 100);
    if (pct !== lastPow) { lastPow = pct; $('power-fill').style.height = pct + '%';
      $('power-btn').classList.toggle('hot', v > 0.8); }
  },
  setLevel(n, total, name) {
    const k = n + '/' + total;
    if (k !== lastLevel) { lastLevel = k; $('level').textContent = k; $('levelname').textContent = name; }
  },
  setGoal(g) {
    if (g === lastGoal) return; lastGoal = g;
    $('goal').textContent = g === 'topple' ? 'KNOCK IT OFF THE LEDGE' : 'KNOCK IT OUT';
  },
  setReticle(x, y) {
    const el = $('reticle');
    el.style.left = (x * 100) + '%'; el.style.top = ((1 - y) * 100) + '%';
  },
  flash(text) {
    const el = $('flash'); el.textContent = text;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  },
  showResult(score, best, isRecord, shots, level, total) {
    $('result-score').textContent = score;
    $('result-sub').textContent = shots + ' ARROW' + (shots === 1 ? '' : 'S') + ' · SCORE';
    $('result-best').textContent = 'Best ' + best;
    const badge = $('result-badge');
    badge.textContent = isRecord && score > 0 ? 'NEW BEST!' : 'CLEARED!';
    badge.classList.toggle('record', isRecord && score > 0);
    $('btn-next').textContent = level >= total ? 'LEVEL 1' : 'NEXT LEVEL';
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
try { audio = new Audio(); input = new Input(); } catch (e) { showError(e); }

function begin() {
  if (started) return;
  started = true;
  try { audio.start(); } catch (e) {}
  try {
    game = new Game($('scene'), audio, input, hud);
    window.__game = game;
    game.onError = showError;
    document.body.classList.add('playing');
    $('start').classList.add('hidden');
    game.start();
  } catch (e) { started = false; showError(e); }
}

const startEl = $('start');
startEl.addEventListener('pointerdown', begin);
addEventListener('keydown', (e) => { if ((e.key === 'Enter') && !started) begin(); });

$('btn-again').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (game) game.restart(); });
$('btn-next').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (game) game.nextLevel(); });
