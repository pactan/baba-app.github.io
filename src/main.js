import { Game } from './game.js?v=17';
import { Input } from './input.js?v=17';
import { Audio } from './audio.js?v=17';

const $ = (id) => document.getElementById(id);

let lastScore = -1, lastBest = -1, lastPot = -1, lastStreak = '', lastRisk = -1;
const hud = {
  setScore(v) { if (v !== lastScore) { lastScore = v; $('score').textContent = v.toLocaleString(); } },
  setBest(v) { if (v !== lastBest) { lastBest = v; $('best').textContent = v.toLocaleString(); } },
  setPot(v) {
    if (v === lastPot) return; lastPot = v;
    const el = $('pot'); el.textContent = v.toLocaleString();
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    $('bankamt').textContent = v > 0 ? ' ' + v.toLocaleString() : '';
    $('btn-bank').classList.toggle('ready', v > 0);
  },
  setStreak(streak, mult) {
    const key = streak + '|' + mult;
    if (key === lastStreak) return; lastStreak = key;
    $('streak').textContent = streak > 0 ? (streak + ' HOPS · ' + mult + '×') : '';
  },
  setRisk(pct, perfect) {
    pct = Math.round(pct);
    if (pct !== lastRisk) {
      lastRisk = pct;
      $('riskpct').textContent = pct;
      $('riskfill').style.width = pct + '%';
      const bar = $('riskbar');
      bar.classList.toggle('hi', pct >= 55);
      bar.classList.toggle('mid', pct >= 30 && pct < 55);
    }
    if (perfect) { const w = $('riskwrap'); w.classList.remove('perfect'); void w.offsetWidth; w.classList.add('perfect'); }
  },
  bankFlash(amt) {
    const el = $('pot'); el.classList.remove('cash'); void el.offsetWidth; el.classList.add('cash');
  },
  showResult(score, best, isRecord, busted) {
    $('result-score').textContent = score.toLocaleString();
    $('result-best').textContent = 'Best ' + best.toLocaleString();
    const badge = $('result-badge');
    badge.textContent = isRecord && score > 0 ? 'NEW BEST!' : (busted ? 'BUSTED' : 'GAME OVER');
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
