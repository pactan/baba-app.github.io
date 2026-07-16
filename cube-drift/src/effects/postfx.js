// effects/postfx.js
// Bloom-based post processing. Everything is wrapped defensively so that if the
// post-processing addons fail to load for any reason the game still renders.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.ok = false;
    try {
      const size = renderer.getSize(new THREE.Vector2());
      this.composer = new EffectComposer(renderer);
      this.composer.addPass(new RenderPass(scene, camera));
      this.bloom = new UnrealBloomPass(size, 0.85, 0.7, 0.6);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
      this.ok = true;
    } catch (e) {
      console.warn('PostFX disabled:', e);
    }
  }

  setBloom(strength) {
    if (this.ok) this.bloom.strength = strength;
  }

  resize(w, h, dpr) {
    if (this.ok) {
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(w, h);
    }
  }

  render() {
    if (this.ok) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
