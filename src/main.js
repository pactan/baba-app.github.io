import { Game } from './game.js?v=24';
import { Input } from './input.js?v=24';
import { Audio } from './audio.js?v=24';

const $ = (id) => document.getElementById(id);
let lastDist = -1, lastBest = -1, lastCombo = -1, lastPow = -1, lastPhase = '';
const hud = {
  setDist(v) { if (v !== lastDist) { lastDist = v; const el = $('dist'); el.firstChild.textContent = v; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); } },
  setBest(v) { if (v !== lastBest) { lastBest = v; $('best').textContent = v; } },
  setCombo(c) { if (c === lastCombo) return; lastCombo = c; const el = $('combo'); el.textContent = c >= 2 ? c + '× COMBO' : ''; el.classList.toggle('on', c >= 2); },
  setPower(v) { if (Math.round(v * 100) === lastPow) return; lastPow = Math.round(v * 100); $('power-fill').style.width = lastPow + '%'; $('power-wrap').classList.toggle('on', v > 0.001); },
  setPhase(p) {
    if (p === lastPhase) return; lastPhase = p;
    const h = $('hint');
    h.textContent = p === 'ready' ? 'HOLD to wind up · release to launch'
      : p === 'flying' ? 'HOLD to tuck & flip · release to land feet-first'
      : p === 'landed' ? 'STICK! keep going…' : '';
    h.style.opacity = (p === 'ready' || p === 'flying') ? '1' : '0';
  },
  flash(t) { const el = $('flash'); el.textContent = t; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); },
  showResult(score, best, isRecord, sticks, combo) {
    $('result-score').firstChild.textContent = score;
    $('result-line').textContent = sticks + (sticks === 1 ? ' stick' : ' sticks') + (combo > 1 ? ' · best ×' + combo : '');
    $('result-best').textContent = 'Best ' + best + 'm';
    const b = $('result-badge'); b.textContent = isRecord && score > 0 ? 'NEW BEST!' : (score >= 60 ? 'HUGE!' : score >= 25 ? 'NICE!' : 'OOF');
    b.classList.toggle('record', isRecord && score > 0);
    $('result').classList.remove('hidden');
  },
  hideResult() { $('result').classList.add('hidden'); },
};

function showError(e) { const s = $('start'); s.classList.remove('hidden'); $('err').textContent = 'Error: ' + (e && (e.message || e)) + (e && e.stack ? '\n' + e.stack.split('\n').slice(0, 3).join('\n') : ''); }
addEventListener('error', (ev) => showError(ev.error || ev.message));
addEventListener('unhandledrejection', (ev) => showError(ev.reason));

let audio, input, game, started = false;
try { audio = new Audio(); input = new Input(); } catch (e) { showError(e); }
function begin() {
  if (started) return; started = true;
  try { audio.start(); } catch (e) {}
  try { game = new Game($('scene'), audio, input, hud); window.__game = game; game.onError = showError; document.body.classList.add('playing'); $('start').classList.add('hidden'); game.start(); }
  catch (e) { started = false; showError(e); }
}
$('start').addEventListener('pointerdown', begin);
addEventListener('keydown', (e) => { if (e.key === 'Enter' && !started) begin(); });
$('btn-again').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (game) game.restart(); });
