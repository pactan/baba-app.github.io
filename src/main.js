import { Feedback, hapticsSupported } from './feedback.js';
import { Stage } from './stage.js';
import { PopStation } from './stations/pop.js';
import { ClickStation } from './stations/click.js';

// --- settings (persisted) ---
const settings = Object.assign(
  { volume: 0.8, haptics: true, reducedMotion: false },
  load('settings', {})
);
if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) settings.reducedMotion = true;

function load(key, fallback) {
  try { const v = localStorage.getItem('fidget.' + key); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
function saveSettings() {
  try { localStorage.setItem('fidget.settings', JSON.stringify(settings)); } catch {}
}

// --- HUD ---
const el = (id) => document.getElementById(id);
const hud = {
  setStat: (html) => { el('stat').innerHTML = html; },
  setTitle: (s) => {
    el('station-title').textContent = s.title;
    el('station-index').textContent = s.index;
  },
};

const feedback = new Feedback(settings);

const ctx = {
  feedback,
  settings,
  hud,
  onPageChange: (i, station) => {
    hud.setTitle(station);
    hud.setStat(station.info());
    [...el('dots').children].forEach((d, k) => d.classList.toggle('active', k === i));
  },
  onSwipe: () => el('hint')?.classList.add('gone'),
};

// --- build stage + stations ---
const stage = new Stage(el('scene'), ctx);
stage.add(new PopStation(ctx));
stage.add(new ClickStation(ctx));

// nav dots
const dots = el('dots');
stage.stations.forEach((s, i) => {
  const b = document.createElement('button');
  b.addEventListener('click', () => stage.goTo(i));
  dots.appendChild(b);
});

ctx.onPageChange(0, stage.stations[0]);
stage.start();

// --- audio unlock (iOS needs a gesture) + tap-to-start overlay ---
const overlay = el('tap-to-start');
const start = () => {
  feedback.unlock();
  overlay.classList.add('hidden');
  setTimeout(() => el('hint')?.classList.add('gone'), 4000);
};
overlay.addEventListener('pointerdown', start, { once: true });

// --- settings panel ---
const panel = el('settings');
el('settings-btn').addEventListener('click', () => panel.classList.remove('hidden'));
el('settings-close').addEventListener('click', () => panel.classList.add('hidden'));

const vol = el('set-volume');
vol.value = settings.volume;
vol.addEventListener('input', () => {
  settings.volume = parseFloat(vol.value);
  feedback.sound.setVolume(settings.volume);
  saveSettings();
});

const hap = el('set-haptics');
hap.checked = settings.haptics;
hap.addEventListener('change', () => { settings.haptics = hap.checked; saveSettings(); });
if (!hapticsSupported) {
  el('haptic-note').textContent = '(not supported on this browser — iOS/desktop)';
}

const red = el('set-reduced');
red.checked = settings.reducedMotion;
red.addEventListener('change', () => { settings.reducedMotion = red.checked; saveSettings(); });
