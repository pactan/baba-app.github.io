// main.js
// Bootstraps every subsystem and drives the game loop. Kept deliberately as the
// single place that owns orchestration; the heavy lifting lives in the modules
// under engine/ physics/ game/ effects/ audio/ ui/.

import * as THREE from 'three';
import { Physics } from './physics/world.js';
import { Level, DIRS, TILE } from './game/level.js';
import { ChaseCamera } from './engine/camera.js';
import { Input } from './engine/input.js';
import { HUD } from './ui/hud.js';
import { Audio } from './audio/audio.js';
import { Trail } from './effects/trail.js';
import { Particles } from './effects/particles.js';
import { PostFX } from './effects/postfx.js';
import { GameState, STATE } from './game/game.js';

// ---------- renderer / scene ----------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x05010f, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const DPR = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(DPR);
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05010f);
scene.fog = new THREE.FogExp2(0x05010f, 0.0135);

const chase = new ChaseCamera(window.innerWidth / window.innerHeight);

// lights — cheap; emissive materials + bloom do most of the work
scene.add(new THREE.HemisphereLight(0x223a66, 0x0a0214, 0.7));
const dir = new THREE.DirectionalLight(0x9fd8ff, 0.8);
dir.position.set(1, 2, 1);
scene.add(dir);
const cubeLight = new THREE.PointLight(0x18f0ff, 8, 14, 2);
scene.add(cubeLight);

// synthwave floor grid that we re-centre under the cube to feel infinite
const grid = new THREE.GridHelper(600, 120, 0x18f0ff, 0x2a1140);
grid.position.y = -7;
grid.material.transparent = true;
grid.material.opacity = 0.35;
scene.add(grid);

// ---------- player cube ----------------------------------------------------
const cubeGroup = new THREE.Group();
const cubeMesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({
    color: 0x0c0a26, emissive: 0x18f0ff, emissiveIntensity: 0.6,
    metalness: 0.3, roughness: 0.35,
  })
);
const cubeEdges = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)),
  new THREE.LineBasicMaterial({ color: 0x8ffcff })
);
cubeGroup.add(cubeMesh, cubeEdges);
scene.add(cubeGroup);

// ---------- subsystems -----------------------------------------------------
const physics = new Physics();
let level, trail, particles, postfx, gs;
const audio = new Audio();
const hud = new HUD();
const input = new Input(window);

let ready = false;

// gameplay vectors
const moveDir = new THREE.Vector3(1, 0, 0);   // actual velocity direction
let dirIndex = 0;                              // which DIRS entry we're turning to
let drifting = false;
let driftAmt = 0;                              // 0..1 smoothed
let timeScale = 1, timeScaleTarget = 1;
let dyingTimer = 0;
const tumble = new THREE.Vector3();
const _pos = new THREE.Vector3();

// ---------- init -----------------------------------------------------------
async function init() {
  await physics.init();
  level = new Level(scene, physics);
  trail = new Trail(scene);
  particles = new Particles(scene);
  postfx = new PostFX(renderer, scene, chase.cam);
  gs = new GameState();
  hud.showMenu(gs.best);
  ready = true;
  wireInput();
  requestAnimationFrame(loop);
}

function wireInput() {
  input.onAnyPress = () => {
    audio.start(); audio.resume();
    if (gs.state === STATE.MENU) startRun();
    else if (gs.state === STATE.DEAD) startRun();
  };
  input.onTap = () => {
    if (gs.state !== STATE.PLAYING) return;
    dirIndex ^= 1;                          // toggle between +X and +Z
    if (gs.speed01() > 0.4) chase.addShake(0.18);
  };
  input.onDriftStart = () => { if (gs.state === STATE.PLAYING) { drifting = true; audio.drift(true); } };
  input.onDriftEnd = () => { drifting = false; audio.drift(false); };
}

function startRun() {
  gs.reset();
  gs.state = STATE.PLAYING;
  dirIndex = 0;
  moveDir.set(1, 0, 0);
  drifting = false; driftAmt = 0;
  timeScale = timeScaleTarget = 1;
  audio.duck(false);

  level.reset();
  trail.reset();
  particles.reset();
  physics.spawnCube({ x: 0, y: 0.55, z: 0 }, 0.5);
  cubeGroup.position.set(0, 0.55, 0);
  cubeGroup.rotation.set(0, 0, 0);
  chase.snap(cubeGroup.position, moveDir);

  hud.showGame();
  hud.setScore(0);
  input.enabled = true;
}

// ---------- main loop ------------------------------------------------------
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;                  // clamp big stalls

  timeScale += (timeScaleTarget - timeScale) * 0.12;
  const dts = dt * timeScale;

  if (gs && gs.state === STATE.PLAYING) stepPlaying(dts);
  else if (gs && gs.state === STATE.DYING) stepDying(dt, dts);

  // keep cube light + grid glued to the cube
  cubeLight.position.copy(cubeGroup.position).y += 1.2;
  grid.position.x = Math.round(cubeGroup.position.x / 5) * 5;
  grid.position.z = Math.round(cubeGroup.position.z / 5) * 5;

  const speed01 = gs ? gs.speed01() : 0;
  chase.update(cubeGroup.position, moveDir, speed01, dt);
  if (level) level.update(performance.now() / 1000);
  if (particles) particles.update(dts);

  if (postfx) {
    postfx.setBloom(0.7 + speed01 * 0.9 + driftAmt * 0.6);
    postfx.render();
  } else {
    renderer.render(scene, chase.cam);
  }
}

function stepPlaying(dts) {
  gs.time += dts;
  // speed eases toward its target; difficulty drives run length + ramp
  gs.speed += (gs.speedTarget() - gs.speed) * (1 - Math.pow(0.05, dts));

  // turn handling: instant snap normally, slippery while drifting
  driftAmt += ((drifting ? 1 : 0) - driftAmt) * (1 - Math.pow(0.01, dts));
  const target = DIRS[dirIndex];
  const rate = drifting ? 1 - Math.pow(0.02, dts) : 1;   // 1 = instant
  moveDir.lerp(target, Math.min(1, rate));
  if (moveDir.lengthSq() < 1e-4) moveDir.copy(target);
  moveDir.normalize();

  // drive the dynamic body's horizontal velocity, keep gravity on Y
  const vy = physics.cubeVelocity().y;
  physics.setCubeVelocity(moveDir.x * gs.speed, vy, moveDir.z * gs.speed);

  physics.world.timestep = Math.max(1 / 240, dts);
  physics.step();

  const t = physics.cubePosition();
  cubeGroup.position.set(t.x, t.y, t.z);
  _pos.copy(cubeGroup.position);

  // distance & score (distance-based + shard bonus, tracked separately)
  gs.distance += gs.speed * dts;
  const sc = Math.floor(gs.distance / TILE) + gs.bonus;
  if (sc !== gs.score) { gs.score = sc; hud.setScore(sc); }
  hud.setSpeed(gs.speed * 11.5);

  // extend / recycle the world
  level.ensureAhead(_pos, 75, gs.difficulty());
  level.recycle(_pos);

  // shards
  const got = level.collect(_pos, 1.0, (x, y, z) => {
    particles.burst(x, y, z, 14, new THREE.Color(0xfff2a0), 5);
  });
  if (got) {
    gs.bonus += got * 4;
    gs.score = Math.floor(gs.distance / TILE) + gs.bonus;
    hud.setScore(gs.score);
    hud.popScore(); audio.pickup(); chase.addShake(0.1);
  }

  // drift juice
  if (driftAmt > 0.2) {
    particles.driftSparks(_pos, moveDir, driftAmt);
    audio.duck(false);
  }
  audio.setIntensity(gs.speed01() * 0.8 + driftAmt * 0.3);
  trail.push(_pos, moveDir, driftAmt, gs.speed01());

  // death: cube has dropped off an edge
  if (t.y < 0.2 && physics.cubeVelocity().y < -1) {
    beginDeath();
  }
}

function beginDeath() {
  gs.state = STATE.DYING;
  dyingTimer = 0;
  timeScaleTarget = 0.35;             // cinematic slow-mo
  input.enabled = false;
  drifting = false; audio.drift(false);
  audio.duck(true); audio.crash();
  hud.hit('magenta');
  chase.addShake(1);
  const t = physics.cubePosition();
  particles.burst(t.x, t.y, t.z, 60, new THREE.Color(0x18f0ff), 9);
  particles.burst(t.x, t.y, t.z, 40, new THREE.Color(0xff2bd6), 7);
  tumble.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
}

function stepDying(dt, dts) {
  dyingTimer += dt;
  // let the cube keep falling under gravity
  const vy = physics.cubeVelocity().y;
  physics.setCubeVelocity(moveDir.x * gs.speed * 0.4, vy, moveDir.z * gs.speed * 0.4);
  physics.world.timestep = Math.max(1 / 240, dts);
  physics.step();
  const t = physics.cubePosition();
  cubeGroup.position.set(t.x, t.y, t.z);
  cubeGroup.rotation.x += tumble.x * dt;
  cubeGroup.rotation.y += tumble.y * dt;
  cubeGroup.rotation.z += tumble.z * dt;
  trail.push(cubeGroup.position, moveDir, 0, gs.speed01());

  if (dyingTimer > 1.0 || t.y < -14) {
    gs.state = STATE.DEAD;
    timeScaleTarget = 1;
    const isNew = gs.saveBest();
    audio.duck(false);
    audio.setIntensity(0);
    hud.showGameOver(gs.score, gs.best, isNew);
    setTimeout(() => { input.enabled = true; }, 350);   // brief lockout before retry
  }
}

// ---------- resize ---------------------------------------------------------
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  chase.resize(w / h);
  if (postfx) postfx.resize(w, h, DPR);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 200));

init().catch((e) => {
  console.error(e);
  document.getElementById('menu').innerHTML =
    '<div class="menu-inner"><h1 class="logo">CUBE<span>DRIFT</span></h1>' +
    '<p class="hint">Failed to load the physics engine.<br>Check your connection and reload.</p></div>';
});
