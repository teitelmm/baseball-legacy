import * as THREE from 'three';
import { CATCHER_Z, MOUND_HEIGHT, RUBBER_Z } from '../core/constants';
import type { FieldPosition, Handedness, TeamColors } from '../core/types';
import { FIELD_POSITIONS } from '../core/types';
import { BASES, FIELD_SPOTS, type XZ } from '../sim/field';
import type { PlaySim } from '../sim/playSim';
import {
  BATTER_STANCE,
  catcherPose,
  divePose,
  fielderReadyPose,
  LEADOFF_POSE,
  pickupPose,
  pitcherSetPose,
  reachPose,
  runPose,
  throwPose,
  transferPose,
  UMPIRE_POSE,
} from './animations';
import type { PlayerProfile } from '../sim/profile';
import { Humanoid, type Appearance } from './humanoid';

export const BATTER_OFFSET = 2.6; // ft from the plate center to the batter's root
export const CATCHER_ROOT_Z = CATCHER_Z + 1.0;

const UMPIRE: Appearance = { jersey: '#1b2230', pants: '#59606b', skin: '#e0b48f', cap: '#111111' };
const SKINS = ['#c68d62', '#8d5a3b', '#e0b48f', '#a86f4c', '#f0c8a0', '#6b4430'];

const HAIRS: Array<Appearance['hair']> = ['short', 'buzz', 'short', 'curly', 'none', 'short', 'long'];
const FACIAL: Array<Appearance['facialHair']> = ['none', 'none', 'stubble', 'beard', 'none', 'goatee', 'mustache'];

/** A generic player for a team: varied skin, hair and build, with a number on the back. */
export function teamAppearance(c: TeamColors, i = 0): Appearance {
  return {
    jersey: c.jersey,
    pants: c.pants,
    cap: c.cap,
    undershirt: c.accent,
    skin: SKINS[i % SKINS.length],
    hair: HAIRS[i % HAIRS.length],
    facialHair: FACIAL[(i * 3) % FACIAL.length],
    build: i % 4 === 3 ? 'stocky' : i % 5 === 1 ? 'slim' : 'athletic',
    heightIn: 70 + ((i * 5) % 8),
    number: [2, 5, 8, 11, 17, 22, 24, 27, 31, 34, 44, 51][i % 12],
  };
}

/** Your player's look (from the player creator). */
export function profileLook(p: PlayerProfile): Partial<Appearance> {
  const a = p.appearance;
  return {
    skin: a.skin,
    hair: a.hair,
    hairColor: a.hairColor,
    facialHair: a.facialHair,
    build: a.build,
    heightIn: a.heightIn,
    eyeBlack: a.eyeBlack,
    batColor: a.batColor,
    gloveColor: a.gloveColor,
    number: p.number,
    backName: p.lastName,
  };
}

function moundY(x: number, z: number): number {
  const d = Math.hypot(x, z - (RUBBER_Z + 1.5));
  return d < 3 ? MOUND_HEIGHT : d < 9 ? MOUND_HEIGHT * (1 - (d - 3) / 6) : 0;
}

interface Mover {
  model: Humanoid;
  phase: number;
  lastX: number;
  lastZ: number;
  throwAt: number;
  /** 0 = relaxed between pitches, 1 = crouched and ready (eased). */
  ready: number;
}

const tmpBall = new THREE.Vector3();

/**
 * Every player on the field: nine fielders (pitcher and catcher included), the batter,
 * up to four runners, and the umpire. Pitch-by-pitch poses are set by the at-bat code;
 * during a play, `applyPlay()` moves everyone from the play simulation.
 */
export class FieldActors {
  readonly group = new THREE.Group();
  readonly fielders = new Map<FieldPosition, Mover>();
  batter!: Humanoid;
  readonly umpire: Humanoid;
  private runners: Mover[] = [];
  private offense: TeamColors;
  private defense: TeamColors;
  private batterBats: Handedness = 'R';
  private pitcherKey = 'R|';
  private pitcherThrows: Handedness = 'R';

  constructor(scene: THREE.Scene, offense: TeamColors, defense: TeamColors) {
    this.offense = offense;
    this.defense = defense;
    scene.add(this.group);
    this.umpire = new Humanoid(UMPIRE);
    this.umpire.root.position.set(0, 0, CATCHER_ROOT_Z + 2.2);
    this.umpire.root.rotation.y = Math.PI;
    this.umpire.apply(UMPIRE_POSE);
    this.group.add(this.umpire.root);
    this.buildDefense();
    this.buildRunners();
    this.setBatter('R');
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
  }

  get pitcher(): Humanoid {
    return this.fielders.get('P')!.model;
  }

  get catcher(): Humanoid {
    return this.fielders.get('C')!.model;
  }

  setTeams(offense: TeamColors, defense: TeamColors): void {
    const changedD = offense !== this.offense || defense !== this.defense;
    this.offense = offense;
    this.defense = defense;
    if (!changedD) return;
    this.buildDefense();
    this.buildRunners();
    this.setBatter(this.batterBats);
  }

  private buildDefense(): void {
    this.pitcherKey = `${this.pitcherThrows}|`;
    for (const m of this.fielders.values()) this.group.remove(m.model.root);
    this.fielders.clear();
    FIELD_POSITIONS.forEach((pos, i) => {
      const lefty = pos === 'P' && this.pitcherThrows === 'L';
      const model = new Humanoid({ ...teamAppearance(this.defense, i), gloveHand: 'L' }, { mirrored: lefty });
      this.group.add(model.root);
      this.fielders.set(pos, { model, phase: i, lastX: 0, lastZ: 0, throwAt: -1, ready: 0 });
    });
    this.resetDefense();
  }

  private buildRunners(): void {
    for (const r of this.runners) this.group.remove(r.model.root);
    this.runners = [];
    for (let i = 0; i < 4; i++) {
      const model = new Humanoid({ ...teamAppearance(this.offense, i + 3), gloveHand: null });
      model.root.visible = false;
      this.group.add(model.root);
      this.runners.push({ model, phase: 0, lastX: 0, lastZ: 0, throwAt: -1, ready: 0 });
    }
  }

  /** Set who's pitching (handedness and, for you, your look). */
  setPitcherHand(throws: Handedness, look: Partial<Appearance> | null = null): void {
    const key = `${throws}|${look ? JSON.stringify(look) : ''}`;
    if (key === this.pitcherKey) return;
    this.pitcherKey = key;
    this.pitcherThrows = throws;
    const old = this.fielders.get('P')!;
    this.group.remove(old.model.root);
    const model = new Humanoid({ ...teamAppearance(this.defense, 0), ...look, gloveHand: 'L' }, { mirrored: throws === 'L' });
    this.group.add(model.root);
    this.fielders.set('P', { model, phase: 0, lastX: 0, lastZ: 0, throwAt: -1, ready: 0 });
    this.resetDefense();
  }

  /** Give one fielder a specific look (your outfielder). */
  setFielderLook(pos: FieldPosition, look: Partial<Appearance>): void {
    const old = this.fielders.get(pos)!;
    this.group.remove(old.model.root);
    const i = FIELD_POSITIONS.indexOf(pos);
    const model = new Humanoid({ ...teamAppearance(this.defense, i), ...look, gloveHand: 'L' });
    this.group.add(model.root);
    this.fielders.set(pos, { model, phase: i, lastX: 0, lastZ: 0, throwAt: -1, ready: 0 });
    this.resetDefense();
  }

  setBatter(bats: Handedness, index = 0, look: Partial<Appearance> | null = null): void {
    if (this.batter) this.group.remove(this.batter.root);
    this.batterBats = bats;
    const lefty = bats === 'L';
    this.batter = new Humanoid({ ...teamAppearance(this.offense, index), ...look, gloveHand: null }, { bat: true, mirrored: lefty });
    this.batter.root.position.set(lefty ? BATTER_OFFSET : -BATTER_OFFSET, 0, -0.4);
    this.batter.root.rotation.y = lefty ? -Math.PI / 2 : Math.PI / 2;
    this.batter.apply(BATTER_STANCE);
    this.group.add(this.batter.root);
  }

  /** Everyone back to their spots for the next pitch. */
  resetDefense(): void {
    for (const [pos, m] of this.fielders) {
      const root = m.model.root;
      root.rotation.x = 0;
      m.ready = 0;
      if (pos === 'P') {
        root.position.set(0, MOUND_HEIGHT, RUBBER_Z);
        root.rotation.y = 0;
        m.model.apply(pitcherSetPose());
      } else if (pos === 'C') {
        root.position.set(0, 0, CATCHER_ROOT_Z);
        root.rotation.y = Math.PI;
        m.model.apply(catcherPose([0, 2.4, 1]));
      } else {
        const s = FIELD_SPOTS[pos];
        root.position.set(s.x, 0, s.z);
        root.rotation.y = Math.atan2(-s.x, -s.z);
        m.model.apply(fielderReadyPose(m.phase, 0));
      }
      m.lastX = root.position.x;
      m.lastZ = root.position.z;
    }
    if (this.batter) this.batter.root.visible = true;
  }

  /**
   * Fielders between pitches: relaxed, then settling into the ready crouch as the
   * pitcher delivers (`ready` true during the windup and the pitch).
   */
  idle(now: number, ready = false, dt = 1 / 60): void {
    for (const [pos, m] of this.fielders) {
      if (pos === 'P' || pos === 'C') continue;
      m.model.root.rotation.x = 0;
      m.ready += ((ready ? 1 : 0) - m.ready) * Math.min(1, dt * 5);
      m.model.apply(fielderReadyPose(now / 600 + m.phase, m.ready));
    }
  }

  /** Show runners leading off their bases (ids on 1st/2nd/3rd). */
  setBaseRunners(bases: ReadonlyArray<string | null>): void {
    for (let i = 0; i < 4; i++) {
      const r = this.runners[i];
      const on = i < 3 ? bases[i] : null;
      r.model.root.visible = !!on;
      if (!on) continue;
      const b = BASES[i + 1];
      const next = BASES[(i + 2) % 4];
      const dir = { x: next.x - b.x, z: next.z - b.z };
      const len = Math.hypot(dir.x, dir.z);
      // A few steps off the bag toward the next base.
      r.model.root.position.set(b.x + (dir.x / len) * 8, 0, b.z + (dir.z / len) * 8);
      r.model.root.rotation.y = Math.atan2(-dir.z, dir.x); // face home-ish (sideways to the line)
      r.model.apply(LEADOFF_POSE);
    }
  }

  // -------------------------------------------------------------------------
  // During a play

  /** Move everyone to match the play simulation. */
  applyPlay(sim: PlaySim, contactElapsed: number): void {
    const ball = sim.ballPosition();
    const b = sim.ball;
    const holderIdx = b.kind === 'held' || b.kind === 'loose' ? b.holder : -1;
    sim.fielders.forEach((f, idx) => {
      const m = this.fielders.get(f.pos)!;
      const root = m.model.root;
      root.rotation.order = 'YXZ';
      const moved = Math.hypot(f.x - m.lastX, f.z - m.lastZ);
      m.lastX = f.x;
      m.lastZ = f.z;
      root.position.set(f.x, moundY(f.x, f.z), f.z);
      root.rotation.x = 0;
      const speed = Math.hypot(f.vx, f.vz);
      if (f.pos === 'C' && contactElapsed < 0.4) return;
      const faceBall = () => (root.rotation.y = Math.atan2(ball.x - f.x, ball.z - f.z));

      // Laying out: tip forward, slide, then get back up.
      if (f.dive) {
        const t = sim.t - f.dive.t0;
        root.rotation.y = Math.atan2(f.dive.dx, f.dive.dz);
        const down = Math.min(1, t / 0.25);
        const up = Math.max(0, (t - 0.55) / 0.35);
        const tip = 1.35 * down * (1 - up);
        root.rotation.x = tip;
        root.position.y += 0.2 * Math.sin(tip);
        m.model.apply(divePose());
        return;
      }

      // Throwing: face the base and go through the crow hop.
      const lastThrow = [...sim.events].reverse().find((e) => e.type === 'throw' && e.from === f.pos);
      if (lastThrow && lastThrow.type === 'throw' && sim.t - lastThrow.time < 0.55) {
        const target = BASES[lastThrow.to % 4];
        root.rotation.y = Math.atan2(target.x - f.x, target.z - f.z);
        m.model.apply(throwPose((sim.t - lastThrow.time + 0.3) / 0.75));
        return;
      }

      // Ball in hand: bring it to the throwing hand, turning toward where he'll throw.
      if (idx === holderIdx && b.kind === 'held') {
        faceBall();
        m.model.apply(speed > 1 ? runPose((m.phase += moved * 0.45), Math.min(1, speed / 26)) : transferPose());
        return;
      }
      // Bobbled ball on the ground: go get it and scoop it up.
      if (idx === holderIdx && b.kind === 'loose') {
        faceBall();
        const d = Math.hypot(ball.x - f.x, ball.z - f.z);
        m.model.apply(d < 4 ? pickupPose() : runPose((m.phase += moved * 0.45), Math.min(1, speed / 26)));
        return;
      }

      const base = speed > 1 ? runPose((m.phase += moved * 0.45), Math.min(1, speed / 26)) : fielderReadyPose(sim.t * 2 + m.phase, 1);
      if (speed > 1) root.rotation.y = Math.atan2(f.vx, f.vz);
      else faceBall();

      // Ball coming to him: reach the glove to where it is (in his own space).
      const dBall = Math.hypot(ball.x - f.x, ball.z - f.z);
      if (b.kind === 'path' && dBall < 12 && ball.y < 9) {
        root.updateMatrixWorld();
        tmpBall.set(ball.x, ball.y, ball.z);
        root.worldToLocal(tmpBall);
        m.model.apply(reachPose(base, [tmpBall.x, tmpBall.y, tmpBall.z]));
        return;
      }
      // Taking a throw at a base: glove up as a target.
      if (b.kind === 'thrown' && b.receiver === idx) {
        faceBall();
        root.updateMatrixWorld();
        tmpBall.set(ball.x, Math.max(2, ball.y), ball.z);
        root.worldToLocal(tmpBall);
        m.model.apply(reachPose(speed > 1 ? base : fielderReadyPose(0, 0.4), [tmpBall.x * 0.3, Math.min(6, tmpBall.y), 1.8]));
        return;
      }
      m.model.apply(base);
    });

    // Runners (the batter-runner replaces the batter once he drops the bat).
    const showBatterModel = contactElapsed < 0.35;
    this.batter.root.visible = showBatterModel;
    sim.runners.forEach((r, i) => {
      const m = this.runners[i];
      if (!m) return;
      const visible = r.state !== 'out' && r.state !== 'scored' && !(r.isBatter && showBatterModel);
      m.model.root.visible = visible;
      if (!visible) return;
      const p = sim.runnerPosition(r);
      const moved = Math.hypot(p.x - m.lastX, p.z - m.lastZ);
      m.lastX = p.x;
      m.lastZ = p.z;
      m.model.root.position.set(p.x, 0, p.z);
      if (r.state === 'run' && moved > 0.001) {
        const target: XZ = BASES[(r.returning ? r.base : r.next ?? r.base) % 4];
        root(m).rotation.y = Math.atan2(target.x - p.x, target.z - p.z);
        m.phase += moved * 0.42;
        m.model.apply(runPose(m.phase, 1));
      } else {
        root(m).rotation.y = Math.atan2(-p.x, -p.z) + Math.PI; // face the infield
        m.model.apply(LEADOFF_POSE);
      }
    });
    for (let i = sim.runners.length; i < this.runners.length; i++) this.runners[i].model.root.visible = false;
  }

  /** World position of a fielder's hand (for the ball in hand). */
  fielderPosition(pos: FieldPosition): THREE.Vector3 {
    return this.fielders.get(pos)!.model.root.position.clone();
  }
}

function root(m: Mover): THREE.Group {
  return m.model.root;
}
