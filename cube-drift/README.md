# Cube Drift

A mobile-first, neon synthwave endless runner. You control a momentum cube that
auto-runs along a procedurally generated zig-zag of suspended platforms. **Tap to
turn 90°, hold to drift.** Miss a corner and you tumble into the void.

Built with **Three.js** (rendering) and **Rapier** (WASM physics), running with
**zero build step** — everything loads from a CDN via an ES-module import map, so
it deploys to GitHub Pages as plain static files.

> Live: `https://<user>.github.io/cube-drift/`

---

## Controls

| Input | Action |
| --- | --- |
| **Tap / click** | Instant 90° turn (snaps between heading +X and +Z) |
| **Hold / swipe** | **Drift** — keeps your speed but turns become slippery, trail flares |
| Keyboard `Space` / `←` / `→` | Turn |
| Keyboard `Shift` / `↓` (hold) | Drift |

Tap **TAP TO START** to begin; after a wipeout, tap anywhere to retry instantly.

## How it plays

- The cube moves forward on its own and **accelerates** as you survive longer.
- The neon path alternates between two perpendicular directions, forming an
  endless diagonal staircase. Every corner needs a turn.
- Collect glowing **shards** for bonus score.
- **Drift** preserves speed through fast sections but makes turns overshoot — high
  risk, high reward.
- Difficulty ramps with time: long calm runs at first, then shorter, twitchier
  segments at higher speed.

## Game feel / juice

- Speed-reactive **FOV** and **bloom** for a warp sensation.
- Glowing **ribbon trail** that widens and shifts colour while drifting.
- **Drift sparks**, **shard burst** and a **wipeout explosion** from a single
  pooled particle system.
- Camera **chase smoothing** + **shake** on fast turns and near-misses.
- **Cinematic slow-motion** death: time dilates and the cube tumbles into the dark.
- Fully **procedural synthwave audio** (bass pulse + arpeggio + drift noise +
  impact) whose intensity tracks your speed. No audio files.
- Haptics-friendly, instant restart, persistent best score (`localStorage`).

## Architecture

```
cube-drift/
├── index.html          # canvas + HUD/menu DOM, CDN import map (three + rapier)
├── styles.css          # neon synthwave UI
└── src/
    ├── main.js         # bootstrap + the game loop (orchestration only)
    ├── engine/
    │   ├── camera.js   # smooth chase camera, speed FOV, shake
    │   └── input.js    # low-latency tap/hold for touch + mouse + keyboard
    ├── physics/
    │   └── world.js    # Rapier wrapper: cube body + pooled platform colliders
    ├── game/
    │   ├── game.js     # state machine, score, difficulty + speed curves
    │   └── level.js    # procedural generation + instanced rendering + pooling
    ├── effects/
    │   ├── trail.js    # additive glowing ribbon
    │   ├── particles.js# one pooled Points system for all sparks/bursts
    │   └── postfx.js    # EffectComposer + UnrealBloom (degrades gracefully)
    ├── audio/
    │   └── audio.js    # procedural WebAudio synthwave engine + SFX
    └── ui/
        └── hud.js      # score/speed readout, menus, flashes
```

**Design notes**

- *Physics control:* the cube is a real Rapier **dynamic** rigid body. We drive
  its horizontal velocity each frame (kinematic-style) but let gravity + collision
  do the rest, so it genuinely falls off platform edges. Rotations are locked for
  crisp control; the death tumble is animated on the mesh.
- *Performance:* all platforms render from **two `InstancedMesh`es** (cyan/magenta)
  with pooled instance slots, and all particles from **one** `Points` system —
  the entire endless world is only a handful of draw calls. Platforms, colliders
  and shards are recycled as you advance. Device pixel ratio is capped at 2.
- *No backend, no build:* dependencies resolve through the import map in
  `index.html`. Nothing to compile.

## Run locally

Because ES modules don't load over `file://`, serve the folder over HTTP:

```bash
# from the cube-drift/ directory
python3 -m http.server 8000
# then open http://localhost:8000
```

(or any static server, e.g. `npx serve`).

## Deploy to GitHub Pages

This project is a static subfolder of a GitHub Pages repo — no pipeline required:

1. Ensure GitHub Pages is enabled for the repository (Settings → Pages → deploy
   from branch, e.g. `main`).
2. Commit the `cube-drift/` folder and push.
3. It's live at `https://<user>.github.io/cube-drift/`.

All asset/dependency URLs are absolute (CDN) or relative, so it works from any
sub-path without configuration.

## Tech

- [Three.js](https://threejs.org/) `0.160`
- [Rapier3D](https://rapier.rs/) `@dimforge/rapier3d-compat 0.14` (WASM, inlined)
- WebAudio API, no external audio assets
- Vanilla ES modules — no bundler, no framework

## Tuning cheatsheet

| What | Where |
| --- | --- |
| Start / max speed, difficulty ramp | `src/game/game.js` |
| Tile size, platform width, run lengths | `src/game/level.js` |
| Camera distance / height / FOV | `src/engine/camera.js` |
| Bloom strength curve | `src/main.js` (`postfx.setBloom`) |
| Music/SFX | `src/audio/audio.js` |
