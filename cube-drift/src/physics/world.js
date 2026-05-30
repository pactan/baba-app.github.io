// physics/world.js
// Thin wrapper around Rapier (WASM). The cube is a dynamic rigid body whose
// horizontal velocity we drive directly each frame (kinematic-style control of
// a dynamic body) so it keeps real gravity + collision response — it genuinely
// falls off the edge of a platform, which is the whole game.

import RAPIER from '@dimforge/rapier3d-compat';

export class Physics {
  constructor() {
    this.world = null;
    this.cube = null;
    this.R = RAPIER;
  }

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -34, z: 0 });
    this.world.timestep = 1 / 60;
    return this;
  }

  /** Create (or reset) the player cube at a position. Rotation is locked for
   *  crisp, jitter-free control; the death tumble is faked in the renderer. */
  spawnCube(pos, half = 0.5) {
    if (this.cube) { this.world.removeRigidBody(this.cube); this.cube = null; }

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .lockRotations()
      .setLinearDamping(0.04)
      .setCcdEnabled(true);            // avoid tunnelling through thin platforms at speed
    const body = this.world.createRigidBody(bodyDesc);

    const colDesc = RAPIER.ColliderDesc.cuboid(half, half, half)
      .setFriction(0.25)
      .setRestitution(0.0);
    this.world.createCollider(colDesc, body);

    this.cube = body;
    return body;
  }

  /** Fixed platform collider. Returns the body so the level can recycle it. */
  addPlatform(cx, cy, cz, hx, hy, hz) {
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz);
    const body = this.world.createRigidBody(desc);
    const col = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.4);
    this.world.createCollider(col, body);
    return body;
  }

  remove(body) {
    if (body) this.world.removeRigidBody(body);
  }

  // --- cube helpers -------------------------------------------------------
  setCubeVelocity(x, y, z) { this.cube.setLinvel({ x, y, z }, true); }
  cubeVelocity() { return this.cube.linvel(); }
  cubePosition() { return this.cube.translation(); }
  setCubePosition(x, y, z) { this.cube.setTranslation({ x, y, z }, true); }

  step() { this.world.step(); }
}
