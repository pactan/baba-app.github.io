import * as THREE from 'three';
import { Feedback, hapticsSupported } from './feedback.js';
import { Stage } from './stage.js';
import { PopStation } from './stations/pop.js';
import { ClickStation } from './stations/click.js';
import { SpinStation } from './stations/spin.js';
import { SlideStation } from './stations/slide.js';
import { FlipStation } from './stations/flip.js';
import { SquishStation } from './stations/squish.js';
import { RatchetStation } from './stations/ratchet.js';
import { KeysStation } from './stations/keys.js';
import { LockStation } from './stations/lock.js';
import { GearsStation } from './stations/gears.js';
import { ZipperStation } from './stations/zipper.js';
import { ScissorsStation } from './stations/scissors.js';

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
  _lastStat: null,
  setStat: (html) => { if (html !== hud._lastStat) { hud._lastStat = html; el('stat').innerHTML = html; } },
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
// Project a world point to normalized device coords — lets a station measure a
// rotational gesture around an off-center pivot.
ctx.project = (vec) => vec.clone().project(stage.camera);
// Intersect the pointer ray with a world plane z = const, returning the world
// point. Lets a station drag something onto a chosen depth plane.
const _ray = new THREE.Raycaster();
ctx.rayToZ = (ndc, z) => {
  _ray.setFromCamera(ndc, stage.camera);
  const o = _ray.ray.origin, d = _ray.ray.direction;
  const t = (z - o.z) / d.z;
  return new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, z);
};
stage.add(new PopStation(ctx));
stage.add(new ClickStation(ctx));
stage.add(new SpinStation(ctx));
stage.add(new SlideStation(ctx));
stage.add(new FlipStation(ctx));
stage.add(new SquishStation(ctx));
stage.add(new RatchetStation(ctx));
stage.add(new KeysStation(ctx));
stage.add(new LockStation(ctx));
stage.add(new GearsStation(ctx));
stage.add(new ZipperStation(ctx));
stage.add(new ScissorsStation(ctx));

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
