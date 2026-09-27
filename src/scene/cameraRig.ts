import * as THREE from 'three';
import { RUBBER_Z } from '../core/constants';
import type { Handedness, Vec3 } from '../core/types';

export type CameraMode = 'batting' | 'pitching' | 'follow';

interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

/** Batting, pitching and ball-flight cameras with smooth transitions. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'batting';
  private look = new THREE.Vector3();
  private blend = 1;
  private from: Shot | null = null;
  private followTarget = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 8000);
  }

  battingShot(bats: Handedness): Shot {
    // Behind the plate (catcher and umpire are hidden in this view), shaded slightly
    // away from the batter so he doesn't block the zone.
    const away = bats === 'R' ? 1 : -1;
    return { pos: new THREE.Vector3(away * 0.8, 4.4, 10.5), look: new THREE.Vector3(away * 0.1, 3.1, -30), fov: 38 };
  }

  pitchingShot(throws: Handedness): Shot {
    // High behind the mound, over the pitcher's glove side, looking in at the plate.
    const glove = throws === 'R' ? 1 : -1;
    return { pos: new THREE.Vector3(glove * 2.8, 11.2, RUBBER_Z - 24), look: new THREE.Vector3(0, 2.4, 0), fov: 13 };
  }

  private current(): Shot {
    return { pos: this.camera.position.clone(), look: this.look.clone(), fov: this.camera.fov };
  }

  setShot(mode: CameraMode, shot: Shot | null, instant = false): void {
    this.from = instant ? null : this.current();
    this.blend = instant ? 1 : 0;
    this.mode = mode;
    if (shot) this.target = shot;
    if (instant && shot) this.applyShot(shot);
  }

  /** True once a camera transition has finished. */
  get settled(): boolean {
    return this.blend >= 1;
  }

  private target: Shot = { pos: new THREE.Vector3(0, 5, 12), look: new THREE.Vector3(0, 3, -30), fov: 40 };

  private applyShot(s: Shot): void {
    this.camera.position.copy(s.pos);
    this.look.copy(s.look);
    this.camera.fov = s.fov;
    this.camera.lookAt(this.look);
    this.camera.updateProjectionMatrix();
  }

  follow(ball: Vec3): void {
    this.followTarget.set(ball.x, ball.y, ball.z);
  }

  update(dt: number): void {
    let shot = this.target;
    if (this.mode === 'follow') {
      const b = this.followTarget;
      const dist = Math.hypot(b.x, b.z);
      shot = {
        pos: new THREE.Vector3(b.x * 0.12, 30 + Math.min(40, dist * 0.08), 70),
        look: b.clone(),
        fov: THREE.MathUtils.clamp(55 - dist * 0.075, 24, 55),
      };
    }
    if (this.blend < 1 && this.from) {
      this.blend = Math.min(1, this.blend + dt / 0.6);
      const k = this.blend * this.blend * (3 - 2 * this.blend);
      const s: Shot = {
        pos: this.from.pos.clone().lerp(shot.pos, k),
        look: this.from.look.clone().lerp(shot.look, k),
        fov: THREE.MathUtils.lerp(this.from.fov, shot.fov, k),
      };
      this.applyShot(s);
    } else {
      if (this.mode === 'follow') {
        // Ease the look target so fast balls don't jerk the camera.
        const s = { ...shot, look: this.look.clone().lerp(shot.look, Math.min(1, dt * 10)) };
        this.applyShot(s);
      } else {
        this.applyShot(shot);
      }
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
