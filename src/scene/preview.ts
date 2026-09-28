import * as THREE from 'three';
import type { Handedness, TeamColors } from '../core/types';
import { BATTER_STANCE, fielderReadyPose } from './animations';
import { teamAppearance } from './actors';
import { Humanoid, type Appearance } from './humanoid';

/** Your player on the field, slowly turning, for the home screen and the creator. */
export class PlayerPreview {
  private model: Humanoid | null = null;
  private key = '';
  private spin = 0.6;
  private readonly spot = new THREE.Vector3(0, 0, -20);
  private withBat = true;
  visible = false;

  constructor(private readonly scene: THREE.Scene) {}

  set(look: Partial<Appearance>, colors: TeamColors, bats: Handedness, withBat: boolean): void {
    const key = JSON.stringify([look, colors, bats, withBat]);
    if (key === this.key && this.model) return;
    this.key = key;
    if (this.model) this.scene.remove(this.model.root);
    this.withBat = withBat;
    this.model = new Humanoid(
      { ...teamAppearance(colors, 0), ...look, gloveHand: withBat ? null : 'L' },
      { bat: withBat, mirrored: bats === 'L' && withBat },
    );
    this.model.root.position.copy(this.spot);
    this.model.root.visible = this.visible;
    this.scene.add(this.model.root);
  }

  show(v: boolean): void {
    this.visible = v;
    if (this.model) this.model.root.visible = v;
  }

  /** Turn the model and frame it; `panelFraction` is how much of the screen width the UI panel covers on the left. */
  update(dt: number, now: number, camera: THREE.PerspectiveCamera, panelFraction: number): void {
    if (!this.model || !this.visible) return;
    this.spin += dt * 0.5;
    this.model.root.rotation.y = this.spin;
    this.model.apply(this.withBat ? BATTER_STANCE : fielderReadyPose(now / 700));
    const h = 6.1 * this.model.scale;
    const target = this.spot.clone().add(new THREE.Vector3(0, h * 0.52, 0));
    camera.fov = 32;
    const dist = 21;
    camera.position.set(this.spot.x, target.y + 1.6, this.spot.z + dist);
    // Shift the framing so the player sits in the middle of the space right of the panel.
    const aspect = camera.aspect;
    const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist * aspect;
    const shift = aspect > 1 ? halfW * panelFraction : 0;
    camera.lookAt(target.x - shift, target.y, target.z);
    camera.updateProjectionMatrix();
  }
}
