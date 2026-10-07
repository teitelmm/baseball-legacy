import * as THREE from 'three';
import type { Sfx } from '../audio/sfx';
import type { Input } from '../core/input';
import type { FieldPosition } from '../core/types';
import { basePos, PLAY_DT, PlaySim, type FielderControl, type PlayOutcome, type PlaySetup } from '../sim/playSim';
import type { FieldActors } from '../scene/actors';
import type { BallView } from '../scene/ballView';
import type { CameraRig } from '../scene/cameraRig';
import type { Hud } from '../ui/hud';

const BASE_NAMES = ['home', 'first', 'second', 'third', 'home'];
const LINGER_S = 1.3;

export interface LivePlayDeps {
  scene: THREE.Scene;
  actors: FieldActors;
  ball: BallView;
  cam: CameraRig;
  input: Input;
  hud: Hud;
  sfx: Sfx;
  /** Player names for event call-outs. */
  nameOf?: (id: string) => string;
  /** You hit it: watch it off the bat from the ground for a moment before the wide view. */
  groundCam?: { bats: 'L' | 'R' };
}

/** Seconds the camera stays at ground level, behind the plate, after you hit the ball. */
const GROUND_HOLD_S = 3.0;

/**
 * Plays a ball in play in real time from a PlaySim: fielders chase and throw,
 * runners run. Optionally the user controls one outfielder.
 */
export class LivePlay {
  readonly sim: PlaySim;
  done = false;
  private elapsed = 0;
  private acc = 0;
  private doneFor = 0;
  private eventIdx = 0;
  private pendingThrow: number | null = null;
  private marker: THREE.Mesh | null = null;
  private unsubKey: () => void = () => {};
  private camLook = new THREE.Vector3();
  /** Ground-level camera until this many seconds into the play (0 = not used). */
  private groundUntil = 0;
  /** Test hook: steer the user's fielder toward the landing spot and throw. */
  autoField = false;

  constructor(
    setup: PlaySetup,
    private readonly d: LivePlayDeps,
    private readonly userPosition: FieldPosition | null = null,
  ) {
    if (userPosition) {
      const control: FielderControl = {
        move: () => this.moveInput(),
        takeThrow: () => {
          const t = this.pendingThrow;
          this.pendingThrow = null;
          return t;
        },
      };
      setup = { ...setup, userPosition, control };
      this.unsubKey = d.input.onKey((e) => {
        if (['1', '2', '3', '4'].includes(e.key) && this.sim.userHasBall()) this.pendingThrow = Number(e.key);
      });
      this.marker = new THREE.Mesh(
        new THREE.RingGeometry(2.2, 3.2, 32),
        new THREE.MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
      );
      this.marker.rotation.x = -Math.PI / 2;
      d.scene.add(this.marker);
      d.hud.hint('<kbd>W A S D</kbd> / <kbd>Arrows</kbd> run to the ball &nbsp; catch is automatic &nbsp; then throw <kbd>1</kbd> 1st <kbd>2</kbd> 2nd <kbd>3</kbd> 3rd <kbd>4</kbd> home');
    }
    this.sim = new PlaySim(setup);
    if (!userPosition && d.groundCam) {
      // Stay down at field level behind the plate and watch the ball go.
      this.groundUntil = setup.foul ? 1.6 : GROUND_HOLD_S;
      const start = this.sim.ballPosition();
      this.camLook.set(start.x, start.y, start.z - 20);
      d.cam.setShot('custom', this.groundShot(start), false);
    } else if (!userPosition) d.cam.setShot('follow', null);
    else {
      const f = this.userFielder();
      this.camLook.set(setup.path.landing.x, 20, setup.path.landing.z);
      d.cam.setShot('custom', this.fielderShot(f.x, f.z), true);
    }
  }

  get outcome(): PlayOutcome | null {
    return this.sim.outcome;
  }

  private userFielder() {
    return this.sim.fielders.find((f) => f.pos === this.userPosition)!;
  }

  private moveInput(): { x: number; z: number } {
    if (this.autoField) {
      const f = this.userFielder();
      const target = this.sim.ball.kind === 'path' ? this.sim.landing : { x: f.x, z: f.z };
      const bp = this.sim.ballPosition();
      const t = this.sim.t > this.sim.setup.path.landingTime ? { x: bp.x, z: bp.z } : target;
      const dx = t.x - f.x;
      const dz = t.z - f.z;
      const len = Math.hypot(dx, dz);
      if (this.sim.userHasBall() && this.sim.ball.kind === 'held' && this.sim.t > this.sim.ball.releaseAt) this.pendingThrow = 2;
      return len < 1 ? { x: 0, z: 0 } : { x: dx / len, z: dz / len };
    }
    const i = this.d.input;
    let fwd = 0;
    let side = 0;
    if (i.isDown('w', 'arrowup')) fwd += 1;
    if (i.isDown('s', 'arrowdown')) fwd -= 1;
    if (i.isDown('d', 'arrowright')) side += 1;
    if (i.isDown('a', 'arrowleft')) side -= 1;
    if (!fwd && !side) return { x: 0, z: 0 };
    const cam = this.d.cam.camera;
    const f = new THREE.Vector3();
    cam.getWorldDirection(f);
    f.y = 0;
    f.normalize();
    const r = new THREE.Vector3(-f.z, 0, f.x); // right of forward
    const x = f.x * fwd + r.x * side;
    const z = f.z * fwd + r.z * side;
    const len = Math.hypot(x, z);
    return { x: x / len, z: z / len };
  }

  /**
   * Field-level view from the camera well beside home plate (on the side away from the
   * batter, clear of the catcher and umpire), zooming in as the ball gets farther away.
   */
  private groundShot(ball: { x: number; y: number; z: number }) {
    const away = this.d.groundCam?.bats === 'L' ? -1 : 1;
    const pos = new THREE.Vector3(away * 13, 4.5, 9);
    const dist = Math.hypot(ball.x - pos.x, ball.z - pos.z);
    const fov = THREE.MathUtils.clamp(52 - dist * 0.1, 24, 52);
    return { pos, look: this.camLook.clone(), fov };
  }

  private fielderShot(x: number, z: number) {
    // Behind the fielder, looking in toward the infield / the ball.
    const back = new THREE.Vector3(x, 0, z).normalize();
    const pos = new THREE.Vector3(x + back.x * 30, 12, z + back.z * 30);
    return { pos, look: this.camLook.clone(), fov: 58 };
  }

  update(dt: number): void {
    if (this.done) return;
    this.acc += dt;
    while (this.acc >= PLAY_DT && !this.sim.done) {
      this.sim.step(PLAY_DT);
      this.acc -= PLAY_DT;
    }
    this.elapsed += dt;
    const { actors, ball, cam } = this.d;
    actors.applyPlay(this.sim, this.elapsed);
    const bp = this.sim.ballPosition();
    ball.set(bp, this.elapsed * 20, this.sim.ball.kind === 'path');

    if (this.userPosition) {
      const f = this.userFielder();
      // Don't tilt up so far on a high fly that your fielder drops out of the frame.
      const target = new THREE.Vector3(bp.x, Math.min(bp.y, 24), bp.z);
      if (this.sim.ball.kind !== 'path') target.set((f.x + basePos(2).x) / 2, 5, (f.z + basePos(2).z) / 2);
      this.camLook.lerp(target, Math.min(1, dt * 4));
      const shot = this.fielderShot(f.x, f.z);
      cam.steer(shot.pos, shot.look, shot.fov);
      if (this.marker) {
        this.marker.visible = this.sim.ball.kind === 'path' && this.sim.t < this.sim.setup.path.landingTime;
        this.marker.position.set(this.sim.landing.x, 0.15, this.sim.landing.z);
      }
      if (this.sim.userHasBall()) this.d.hud.hint('Throw: <kbd>1</kbd> first &nbsp; <kbd>2</kbd> second &nbsp; <kbd>3</kbd> third &nbsp; <kbd>4</kbd> home');
    } else if (this.groundUntil > 0) {
      if (this.elapsed < this.groundUntil) {
        // Track the ball from the ground.
        this.camLook.lerp(new THREE.Vector3(bp.x, bp.y, bp.z), Math.min(1, dt * 8));
        const shot = this.groundShot(bp);
        cam.steer(shot.pos, shot.look, shot.fov);
      } else {
        // Then rise to the wide view for the rest of the play.
        this.groundUntil = 0;
        cam.setShot('follow', null);
        cam.follow(bp);
      }
    } else {
      cam.follow(bp);
    }

    this.processEvents();

    if (this.sim.done) {
      this.doneFor += dt;
      if (this.doneFor > LINGER_S) this.done = true;
    }
  }

  private processEvents(): void {
    const { sfx, hud } = this.d;
    const name = (id: string) => this.d.nameOf?.(id) ?? '';
    while (this.eventIdx < this.sim.events.length) {
      const e = this.sim.events[this.eventIdx++];
      switch (e.type) {
        case 'catch':
          sfx.mittPop(80);
          if (e.air && e.pos === this.userPosition) hud.flash('Caught it!');
          else if (e.dive) hud.flash(`Diving stop by the ${e.pos}!`);
          break;
        case 'dive':
          if (!e.caught) hud.flash(`${e.pos} dives... can't get it!`);
          break;
        case 'bobble':
          hud.flash(e.air ? `${e.pos} drops it!` : `${e.pos} bobbles it!`);
          break;
        case 'miss':
          hud.flash(`Past the ${e.pos}!`);
          break;
        case 'wide':
          hud.flash(`Wide throw pulls the ${e.pos} off the bag!`);
          break;
        case 'throw':
          sfx.whoosh();
          break;
        case 'out':
          hud.flash(`${name(e.runnerId)} out at ${BASE_NAMES[e.base]}`.trim());
          break;
        case 'score':
          sfx.crowd(0.4, 1.5);
          hud.flash(`${name(e.runnerId)} scores!`.trim());
          break;
      }
    }
  }

  dispose(): void {
    this.unsubKey();
    if (this.marker) this.d.scene.remove(this.marker);
  }
}
