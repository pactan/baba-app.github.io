// engine/camera.js
// Smooth third-person chase camera with speed-reactive FOV and additive shake.

import * as THREE from 'three';

export class ChaseCamera {
  constructor(aspect) {
    this.cam = new THREE.PerspectiveCamera(72, aspect, 0.1, 400);
    this.baseFov = 72;
    this.targetFov = 72;

    // Offset behind/above the cube, expressed along the diagonal travel heading.
    this.dist = 9.5;
    this.height = 6.2;

    this._pos = new THREE.Vector3(0, this.height, -this.dist);
    this._look = new THREE.Vector3();
    this.shake = 0;          // 0..1, decays each frame
    this._tmp = new THREE.Vector3();
  }

  resize(aspect) {
    this.cam.aspect = aspect;
    this.cam.updateProjectionMatrix();
  }

  addShake(amount) { this.shake = Math.min(1, this.shake + amount); }

  /**
   * @param target  THREE.Vector3 cube position
   * @param heading THREE.Vector3 normalised travel direction (xz plane)
   * @param speed01 0..1 normalised speed for fov/feel
   * @param dt      seconds
   */
  update(target, heading, speed01, dt) {
    // Desired camera position: behind the cube along -heading, lifted up.
    const back = this._tmp.copy(heading).multiplyScalar(-this.dist);
    const desired = back.add(target);
    desired.y = target.y + this.height;

    // Critically-damped style smoothing (frame-rate independent).
    const k = 1 - Math.pow(0.0009, dt);
    this._pos.lerp(desired, k);

    // Look slightly ahead of the cube for a sense of speed.
    const ahead = this._look.copy(heading).multiplyScalar(4 + speed01 * 6).add(target);
    ahead.y = target.y + 1.2;

    // FOV widens with speed -> "warp" feel.
    this.targetFov = this.baseFov + speed01 * 20;
    this.cam.fov += (this.targetFov - this.cam.fov) * (1 - Math.pow(0.01, dt));
    this.cam.updateProjectionMatrix();

    // Apply position + shake.
    this.cam.position.copy(this._pos);
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.9;
      this.cam.position.x += (Math.random() - 0.5) * s;
      this.cam.position.y += (Math.random() - 0.5) * s;
      this.cam.position.z += (Math.random() - 0.5) * s;
      this.shake *= Math.pow(0.0001, dt); // fast decay
    }
    this.cam.lookAt(ahead);
  }

  snap(target, heading) {
    const back = this._tmp.copy(heading).multiplyScalar(-this.dist);
    this._pos.copy(back).add(target);
    this._pos.y = target.y + this.height;
    this.cam.position.copy(this._pos);
    this.cam.fov = this.baseFov;
    this.cam.updateProjectionMatrix();
    this.cam.lookAt(target);
  }
}
