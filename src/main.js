import { Game } from './game.js?v=19';
import { Input } from './input.js?v=19';
import { Audio } from './audio.js?v=19';

const $ = (id) => document.getElementById(id);

let lastScore = -1, lastBest = -1;
const hud = {
  setScore(v) {
    if (v !== lastScore) {
      lastScore = v; const el = $('score'); el.textContent = v;
      el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    }
  },
  setBest(v) { if (v !== lastBest) { lastBest = v; $('best').textContent = v; } },
  showResult(score, best, isRecord) {
    $('result-score').textContent = score;
    $('result-best').textContent = 'Best ' + best;
    const badge = $('result-badge');
    badge.textContent = isRecord && score > 0 ? 'NEW BEST!' : 'GAME OVER';
    badge.classList.toggle('record', isRecord && score > 0);
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
addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !started) begin(); });

$('btn-again').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (game) game.restart(); });
