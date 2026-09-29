import type { FieldingRatings, FieldPosition } from '../core/types';
import { FIELD_POSITIONS, POSITION_NUMBER } from '../core/types';
import type { Vec3 } from '../core/types';
import { pathPositionAt, sprayOf, type BattedBallPath } from './battedBall';
import { fenceDistance } from '../core/constants';
import { BASES, dist, FIELD_SPOTS, inPlayableArea, type XZ } from './field';
import { battedBallType, type BattedBallType } from './outcome';
import { Rng } from '../core/rng';

// ---------------------------------------------------------------------------
// Tunables

export const PLAY_DT = 1 / 60;
const CATCH_HEIGHT = 8;
const INTERCEPT_STEP = 0.05;
const RETHINK_EVERY = 0.2;
const BATTER_START = 0.55;
const TURN_PENALTY = 0.15;
const ADVANCE_MARGIN = 0.35;
const AT_BASE = 4;
const USER_THROW_TIMEOUT = 2.5;
/** Extra reach when a fielder lays out for a ball. */
const DIVE_REACH = 6.5;
/** Time on the ground after a dive before a fielder can throw. */
const DIVE_RECOVERY = 0.9;
const MAX_PLAY_TIME = 30;

const INFIELD: FieldPosition[] = ['1B', '2B', 'SS', '3B'];
const OUTFIELD: FieldPosition[] = ['LF', 'CF', 'RF'];

export function runSpeed(speedRating: number): number {
  return 23 + speedRating * 0.07;
}

/** Fielders' top sprint speed (ft/s). They get there after a read and a few steps of acceleration. */
export function fieldSpeed(speedRating: number): number {
  return 22.5 + speedRating * 0.09;
}

/** How quickly a fielder gets up to speed (ft/s²). */
function fieldAccel(speedRating: number): number {
  return 20 + speedRating * 0.06;
}

/** Long throws lose speed (arc, maybe a hop). */
function throwTime(d: number, arm: number): number {
  return (d / arm) * (1 + Math.max(0, d - 150) / 600);
}

export function throwSpeed(armRating: number): number {
  return 92 + armRating * 0.48;
}

/** The read: time before the first step (acceleration is modeled separately). */
function reactionTime(pos: FieldPosition, glove: number): number {
  const base = OUTFIELD.includes(pos) ? 0.42 : pos === 'P' || pos === 'C' ? 0.4 : 0.18;
  return base - glove * 0.0012;
}

function reach(glove: number): number {
  return 2.9 + glove * 0.012;
}

function transferTime(pos: FieldPosition): number {
  return OUTFIELD.includes(pos) ? 0.8 : pos === 'C' || pos === 'P' ? 0.75 : 0.85;
}

// ---------------------------------------------------------------------------
// Types

export interface FielderSetup {
  id: string;
  fielding: FieldingRatings;
}

export interface RunnerSetup {
  id: string;
  speed: number;
}

export interface FielderControl {
  /** Desired movement direction in world x/z (length ≤ 1). */
  move(): XZ;
  /** Base (1, 2, 3 or 4 = home) the player wants to throw to, or null. */
  takeThrow(): number | null;
}

export interface PlaySetup {
  path: BattedBallPath;
  foul: boolean;
  fielders: Record<FieldPosition, FielderSetup>;
  batter: RunnerSetup;
  /** Runners on first, second, third. */
  runners: [RunnerSetup | null, RunnerSetup | null, RunnerSetup | null];
  outs: number;
  userPosition?: FieldPosition;
  control?: FielderControl;
  /** Seed for the play's luck (bobbles, dives, throws). Defaults to one derived from the ball's path. */
  seed?: number;
}

export type BatterResult = 'single' | 'double' | 'triple' | 'homeRun' | 'out' | 'fc';
export type OutKind = 'groundout' | 'lineout' | 'flyout' | 'popout' | 'forceout' | 'foulout';

export interface PlayOut {
  runnerId: string;
  base: number;
  force: boolean;
  time: number;
}

export interface PlayResult {
  kind: 'play';
  batterResult: BatterResult;
  outKind?: OutKind;
  outs: PlayOut[];
  /** Runners (including the batter) whose runs count. */
  scored: string[];
  /** Runner ids on first, second, third after the play. */
  bases: [string | null, string | null, string | null];
  sacFly: boolean;
  doublePlay: boolean;
  battedBallType: BattedBallType;
  /** e.g. "grounds out, 6-3" (no batter name). */
  description: string;
  /** Scorekeeping chain of fielders who handled the ball. */
  chain: number[];
}

export type PlayOutcome = PlayResult | { kind: 'foul'; description: string };

export type PlayEvent =
  | { type: 'catch'; pos: FieldPosition; air: boolean; time: number; dive?: boolean }
  | { type: 'dive'; pos: FieldPosition; caught: boolean; time: number }
  | { type: 'bobble'; pos: FieldPosition; air: boolean; time: number }
  | { type: 'miss'; pos: FieldPosition; time: number }
  | { type: 'wide'; pos: FieldPosition; time: number }
  | { type: 'throw'; from: FieldPosition; to: number; time: number }
  | { type: 'out'; runnerId: string; base: number; time: number }
  | { type: 'score'; runnerId: string; time: number };

interface PathSample {
  t: number;
  x: number;
  y: number;
  z: number;
  air: boolean;
  /** Catchable height and inside the park. */
  ok: boolean;
}

interface FState {
  pos: FieldPosition;
  id: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  speed: number;
  accel: number;
  arm: number;
  armRating: number;
  glove: number;
  reaction: number;
  reach: number;
  /** Can't field the ball again until then (it just got past him). */
  missUntil: number;
  /** Distance to the ball last step (to spot the moment it's getting away). */
  lastBallD: number | null;
  /** Laying out for a ball. */
  dive: { t0: number; dx: number; dz: number; caught: boolean } | null;
  /** Pulled off the bag by a wide throw until then. */
  offBagUntil: number;
  role: 'chase' | 'cover' | 'idle';
  coverBase: number | null;
  target: XZ | null;
  intercept: { t: number; p: XZ; air: boolean } | null;
}

interface RState {
  id: string;
  isBatter: boolean;
  /** Last base touched (0 = home at the start, 1-3, 4 = scored). */
  base: number;
  /** Base being run to, or null when stopped. */
  next: number | null;
  /** Feet from `base` toward `next`. */
  prog: number;
  returning: boolean;
  state: 'run' | 'safe' | 'out' | 'scored';
  forced: boolean;
  speed: number;
  startAt: number;
  /** Stop at this many feet down the line (going halfway on a fly ball). */
  stopAt: number | null;
  /** Holding at the base to tag up on a fly ball. */
  waitCatch: boolean;
  /** Left the base before a catch (must go back). */
  leftEarly: boolean;
  scoredAt: number;
  /** Decided while rounding the base to keep going. */
  keepGoing: boolean;
}

type BallMode =
  | { kind: 'path' }
  | { kind: 'held'; holder: number; releaseAt: number; decided: boolean; heldSince: number }
  | { kind: 'loose'; holder: number; x: number; z: number; pickAt: number; air: boolean }
  | { kind: 'thrown'; from: Vec3; base: number; receiver: number; t0: number; t1: number; wide: boolean };

export function basePos(b: number): XZ {
  return BASES[((b % 4) + 4) % 4];
}

// ---------------------------------------------------------------------------

/** Deterministic simulation of one ball in play, from contact until the play is dead. */
export class PlaySim {
  t = 0;
  done = false;
  readonly fielders: FState[];
  readonly runners: RState[];
  readonly events: PlayEvent[] = [];
  ball: BallMode = { kind: 'path' };
  private caughtInAir = false;
  private caughtBy: FieldPosition | null = null;
  private fieldedBy: FieldPosition | null = null;
  private outsList: PlayOut[] = [];
  private chain: number[] = [];
  private lastRethink = -1;
  private result: PlayOutcome | null = null;
  private readonly startOuts: number;
  private readonly userIndex: number;
  readonly landing: XZ;
  readonly setup: PlaySetup;
  /** The fielder with the best initial shot at the ball. */
  primary: FieldPosition | null = null;
  private readonly rng: Rng;
  /** A bobble or drop that let the batter reach. */
  private misplay: { pos: FieldPosition; air: boolean } | null = null;

  constructor(setup: PlaySetup) {
    this.setup = setup;
    this.rng = new Rng(setup.seed ?? pathSeed(setup.path));
    this.startOuts = setup.outs;
    this.landing = { x: setup.path.landing.x, z: setup.path.landing.z };
    this.fielders = FIELD_POSITIONS.map((pos) => {
      const f = setup.fielders[pos];
      const spot = FIELD_SPOTS[pos];
      return {
        pos,
        id: f.id,
        x: spot.x,
        z: spot.z,
        vx: 0,
        vz: 0,
        speed: fieldSpeed(f.fielding.speed) * (pos === 'C' ? 0.85 : 1),
        accel: fieldAccel(f.fielding.speed),
        arm: throwSpeed(f.fielding.arm),
        armRating: f.fielding.arm,
        glove: f.fielding.glove,
        reaction: reactionTime(pos, f.fielding.glove),
        reach: reach(f.fielding.glove),
        missUntil: 0,
        lastBallD: null,
        dive: null,
        offBagUntil: 0,
        role: 'idle',
        coverBase: null,
        target: null,
        intercept: null,
      };
    });
    this.userIndex = setup.userPosition ? this.fielders.findIndex((f) => f.pos === setup.userPosition) : -1;

    this.runners = [];
    const batter: RState = this.newRunner(setup.batter, 0, true);
    batter.next = 1;
    batter.startAt = BATTER_START;
    batter.forced = true;
    this.runners.push(batter);
    setup.runners.forEach((r, i) => {
      if (r) this.runners.push(this.newRunner(r, i + 1, false));
    });

    this.initialAssignments();
  }

  private newRunner(r: RunnerSetup, base: number, isBatter: boolean): RState {
    return {
      id: r.id,
      isBatter,
      base,
      next: null,
      prog: 0,
      returning: false,
      state: 'safe',
      forced: false,
      speed: runSpeed(r.speed) * (isBatter ? 0.97 : 1),
      startAt: 0,
      stopAt: null,
      waitCatch: false,
      leftEarly: false,
      scoredAt: -1,
      keepGoing: false,
    };
  }

  // -------------------------------------------------------------------------
  // Queries used by the 3D view

  ballPosition(): Vec3 {
    const b = this.ball;
    if (b.kind === 'path') return pathPositionAt(this.setup.path, Math.min(this.t, this.setup.path.duration));
    if (b.kind === 'held') {
      const f = this.fielders[b.holder];
      return { x: f.x, y: 4.2, z: f.z };
    }
    if (b.kind === 'loose') return { x: b.x, y: 0.25, z: b.z };
    const bp = basePos(b.base);
    const k = Math.min(1, (this.t - b.t0) / (b.t1 - b.t0));
    const arc = Math.sin(Math.PI * k) * Math.min(12, (b.t1 - b.t0) * 6);
    return {
      x: b.from.x + (bp.x - b.from.x) * k,
      y: b.from.y + (4.5 - b.from.y) * k + arc,
      z: b.from.z + (bp.z - b.from.z) * k,
    };
  }

  runnerPosition(r: RState): XZ {
    if (r.state === 'scored') return basePos(0);
    if (r.next === null) return basePos(r.base);
    const a = basePos(r.base);
    const b = basePos(r.next);
    const k = Math.min(1, r.prog / 90);
    return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
  }

  /** The user's fielder currently has the ball and hasn't thrown it. */
  userHasBall(): boolean {
    return this.ball.kind === 'held' && this.ball.holder === this.userIndex;
  }

  get outcome(): PlayOutcome | null {
    return this.result;
  }

  // -------------------------------------------------------------------------
  // Setup

  private get isHomeRun(): boolean {
    return !this.setup.foul && this.setup.path.homeRun;
  }

  private initialAssignments(): void {
    const s = this.setup;
    if (this.isHomeRun) {
      const exit = sprayOf(s.path.landing);
      const [dx, dz] = [Math.sin((exit * Math.PI) / 180), -Math.cos((exit * Math.PI) / 180)];
      const wall = fenceDistance(exit) - 4;
      const spot = { x: dx * wall, z: dz * wall };
      const chasers = this.fielders
        .filter((f) => OUTFIELD.includes(f.pos))
        .sort((a, b) => dist(a, spot) - dist(b, spot))
        .slice(0, 2);
      chasers.forEach((f, i) => {
        // Side by side at the wall, not on top of each other.
        const off = i === 0 ? 0 : 14;
        f.role = 'chase';
        f.target = { x: spot.x - dz * off, z: spot.z + dx * off };
      });
      for (const r of this.runners) {
        r.next = r.base + 1;
        r.state = 'run';
        r.forced = true;
        r.speed *= 0.9; // trot
      }
      return;
    }

    // The fielder with the best shot at the ball goes; everyone else covers first.
    for (const f of this.fielders) f.intercept = this.interceptFor(f);
    let primary: FState | null = null;
    for (const f of this.fielders) {
      if (f.intercept && (!primary || f.intercept.t < primary.intercept!.t)) primary = f;
    }
    this.primary = primary?.pos ?? null;
    const first = primary?.intercept ?? null;
    const likelyCatch = !!first && first.air;
    const catchDepth = first ? Math.hypot(first.p.x, first.p.z) : 0;

    // Base coverage.
    const spray = s.path.init.sprayDeg;
    const assign = (base: number, prefs: FieldPosition[]) => {
      for (const p of prefs) {
        const f = this.fielders.find((x) => x.pos === p)!;
        if (f !== primary && f.role !== 'cover' && this.fielders.indexOf(f) !== this.userIndex) {
          f.role = 'cover';
          f.coverBase = base;
          f.target = this.coverSpot(base);
          return;
        }
      }
    };
    assign(1, ['1B', 'P', '2B']);
    assign(2, spray > 0 ? ['SS', '2B', 'P'] : ['2B', 'SS', 'P']);
    assign(3, ['3B', 'SS', 'P']);
    assign(4, ['C', 'P']);
    this.rethink(true);

    if (s.foul) return;

    // Runners.
    const occupied = [true, !!s.runners[0], !!s.runners[1], !!s.runners[2]];
    for (const r of this.runners) {
      if (r.isBatter) {
        r.state = 'run';
        continue;
      }
      let forced = true;
      for (let b = 0; b < r.base; b++) if (!occupied[b]) forced = false;
      r.forced = forced;
      if (s.outs === 2) {
        this.go(r, 0, 14);
        continue;
      }
      if (likelyCatch) {
        if ((r.base === 3 && catchDepth > 180) || (r.base === 2 && catchDepth > 290)) {
          r.waitCatch = true;
        } else {
          this.go(r, 0);
          r.stopAt = forced ? 38 : 22;
          r.leftEarly = true;
        }
        continue;
      }
      if (forced || this.shouldAdvance(r, ADVANCE_MARGIN - 0.4)) this.go(r, 0, 10);
    }
  }

  private coverSpot(base: number): XZ {
    const b = basePos(base);
    // Stand just on the infield side of the bag.
    const toCenter = { x: -b.x, z: -63.6 - b.z };
    const len = Math.hypot(toCenter.x, toCenter.z) || 1;
    return base === 4 ? { x: 0, z: 1.5 } : { x: b.x + (toCenter.x / len) * 1.5, z: b.z + (toCenter.z / len) * 1.5 };
  }

  private go(r: RState, delay: number, lead = 0): void {
    if (r.base >= 4) return;
    r.next = r.base + 1;
    r.prog = lead;
    r.state = 'run';
    r.returning = false;
    r.startAt = Math.max(r.startAt, this.t + delay);
  }

  // -------------------------------------------------------------------------
  // Fielding

  /** Earliest point on the remaining path this fielder can get to. */
  /** The ball's path sampled once (positions, whether it's catchable and in play). */
  private samples: PathSample[] | null = null;

  private pathSamples() {
    if (this.samples) return this.samples;
    const path = this.setup.path;
    const out: PathSample[] = [];
    for (let i = 0; i * INTERCEPT_STEP <= path.duration + 1e-6; i++) {
      const t = i * INTERCEPT_STEP;
      const p = pathPositionAt(path, t);
      out.push({ t, x: p.x, y: p.y, z: p.z, air: t < path.landingTime, ok: p.y <= CATCH_HEIGHT && inPlayableArea(p) });
    }
    this.samples = out;
    return out;
  }

  private interceptFor(f: FState): FState['intercept'] {
    const path = this.setup.path;
    const react = Math.max(0, f.reaction - this.t);
    const end = path.duration;
    const samples = this.pathSamples();
    for (let i = Math.ceil(this.t / INTERCEPT_STEP - 1e-9); i < samples.length; i++) {
      const p = samples[i];
      const ts = p.t;
      if (this.setup.foul && !p.air) break;
      if (!p.ok) continue;
      const air = p.air;
      if (!this.canReachSpot(f, p, air)) continue;
      // Infielders can only lunge at line drives; they don't get to run them down.
      const lunge = air && !OUTFIELD.includes(f.pos) && p.y < 12 && ts - this.t < 1.2 ? 0.35 : 0;
      if (react + lunge + this.travelTime(f, p.x, p.z) <= ts - this.t) return { t: ts, p: { x: p.x, z: p.z }, air };
    }
    if (this.setup.foul) return null;
    // The ball has stopped: go get it.
    const last = path.points[path.points.length - 1];
    if (!inPlayableArea(last) || !this.canReachSpot(f, last, false)) return null;
    return { t: Math.max(end, this.t + react + this.travelTime(f, last.x, last.z)), p: { x: last.x, z: last.z }, air: false };
  }


  /** Top speed heading toward a spot: outfielders going back on a ball over their head are slower. */
  private topSpeedToward(f: FState, ux: number, uz: number): number {
    if (!OUTFIELD.includes(f.pos)) return f.speed;
    const r = Math.hypot(f.x, f.z) || 1;
    const outward = (ux * f.x + uz * f.z) / r;
    return outward > 0.4 ? f.speed * (1 - 0.1 * ((outward - 0.4) / 0.6)) : f.speed;
  }

  /** Seconds to get within reach of a spot, accelerating from the current velocity. */
  private travelTime(f: FState, px: number, pz: number): number {
    const dx = px - f.x;
    const dz = pz - f.z;
    const d0 = Math.hypot(dx, dz);
    const d = d0 - f.reach;
    if (d <= 0) return 0;
    const ux = dx / d0;
    const uz = dz / d0;
    const vmax = this.topSpeedToward(f, ux, uz);
    const v0 = Math.max(0, Math.min(vmax, f.vx * ux + f.vz * uz));
    const a = f.accel;
    const dAcc = (vmax * vmax - v0 * v0) / (2 * a);
    if (d <= dAcc) return (-v0 + Math.sqrt(v0 * v0 + 2 * a * d)) / a;
    return (vmax - v0) / a + (d - dAcc) / vmax;
  }

  /** Infielders stay in the infield on ground balls; balls that get through are the outfield's. */
  private canReachSpot(f: FState, p: XZ, air: boolean): boolean {
    if (OUTFIELD.includes(f.pos)) return true;
    const d = Math.hypot(p.x, p.z);
    if (f.pos === 'C') return d < 90;
    return air ? d < 190 : d < 140;
  }

  private bestChaser(): FState | null {
    let best: FState | null = null;
    for (const f of this.fielders) {
      if (f.role === 'chase' && f.intercept && (!best || f.intercept.t < best.intercept!.t)) best = f;
    }
    return best;
  }

  /** Recompute intercepts and pick the (up to) two chasers. */
  private rethink(initial = false): void {
    if (this.ball.kind !== 'path') return;
    const candidates = this.fielders.filter((f) => f.role !== 'cover');
    for (const f of candidates) f.intercept = this.interceptFor(f);
    const ranked = candidates
      .filter((f) => f.intercept)
      .sort((a, b) => a.intercept!.t - b.intercept!.t + (a.pos === 'C' ? 0.4 : 0) - (b.pos === 'C' ? 0.4 : 0));
    const chasers = new Set(ranked.slice(0, 2).map((f) => f.pos));
    if (this.userIndex >= 0) chasers.add(this.fielders[this.userIndex].pos);
    for (const f of candidates) {
      if (chasers.has(f.pos)) {
        f.role = 'chase';
        f.target = f.intercept ? f.intercept.p : null;
      } else if (f.role === 'chase' || initial) {
        f.role = 'idle';
        f.target = null;
      }
    }
  }

  private moveFielders(dt: number): void {
    this.fielders.forEach((f, i) => {
      const holding = this.ball.kind === 'held' && this.ball.holder === i;
      // Desired velocity, then accelerate toward it (no instant top speed).
      let wx = 0;
      let wz = 0;
      if (f.dive) {
        // Sliding out on the dive, then getting up.
        const k = Math.max(0, 1 - (this.t - f.dive.t0) / 0.35);
        f.vx = f.dive.dx * 14 * k;
        f.vz = f.dive.dz * 14 * k;
        if (this.t - f.dive.t0 > DIVE_RECOVERY) f.dive = null;
      } else {
        if (i === this.userIndex && this.setup.control && !(this.ball.kind === 'held' && holding && this.t < (this.ball as { releaseAt: number }).releaseAt)) {
          const m = this.setup.control.move();
          const len = Math.hypot(m.x, m.z);
          if (len > 0.01 && this.t >= f.reaction * 0.5) {
            const k = Math.min(1, len) / len;
            const top = this.topSpeedToward(f, m.x / len, m.z / len);
            wx = m.x * k * top;
            wz = m.z * k * top;
          }
        } else if (f.target && this.t >= f.reaction && !holding) {
          const dx = f.target.x - f.x;
          const dz = f.target.z - f.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.3) {
            // Ease up when arriving (brake at about twice the acceleration).
            const sp = Math.min(this.topSpeedToward(f, dx / d, dz / d), Math.sqrt(4 * f.accel * d), d / dt);
            wx = (dx / d) * sp;
            wz = (dz / d) * sp;
          }
        }
        const dvx = wx - f.vx;
        const dvz = wz - f.vz;
        const dv = Math.hypot(dvx, dvz);
        const speeding = Math.hypot(wx, wz) > Math.hypot(f.vx, f.vz);
        const maxDv = (speeding ? 1 : 2.5) * f.accel * dt;
        if (dv > maxDv) {
          f.vx += (dvx / dv) * maxDv;
          f.vz += (dvz / dv) * maxDv;
        } else {
          f.vx = wx;
          f.vz = wz;
        }
      }
      const vx = f.vx;
      const vz = f.vz;
      // Walls are solid: slide along them instead of running through.
      let nx = f.x + vx * dt;
      let nz = f.z + vz * dt;
      if (!insideWalls(nx, nz)) {
        if (insideWalls(nx, f.z)) nz = f.z;
        else if (insideWalls(f.x, nz)) nx = f.x;
        else {
          nx = f.x;
          nz = f.z;
        }
      }
      f.vx = (nx - f.x) / dt;
      f.vz = (nz - f.z) / dt;
      f.x = nx;
      f.z = nz;
    });
  }

  /** Ball speed (ft/s) along its path at time t. */
  private ballSpeedAt(t: number): number {
    const path = this.setup.path;
    const a = pathPositionAt(path, Math.max(0, t - 0.05));
    const b = pathPositionAt(path, Math.min(path.duration, t));
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.05;
  }

  /** Chance a fielder makes the play: harder at the edge of his reach, on the run, on hard-hit balls and on dives. */
  private catchChance(i: number, d: number, air: boolean, ballSpeed: number, height: number, dive: boolean): number {
    const f = this.fielders[i];
    // Your catches are automatic once you get there (you still have to get there).
    if (i === this.userIndex && this.setup.control) return 1;
    const g = (f.glove - 50) / 50;
    if (dive) return clamp((air ? 0.42 : 0.5) + 0.18 * g, 0.2, 0.8);
    const run = Math.min(1, Math.hypot(f.vx, f.vz) / f.speed);
    const edge = Math.max(0, d / f.reach - 0.55) / 0.45;
    let p: number;
    if (air) {
      const hardLiner = height < 5 && ballSpeed > 115 ? 0.05 : 0;
      p = 0.993 - 0.03 * run - 0.07 * edge * edge - hardLiner;
    } else {
      const hard = Math.max(0, ballSpeed - 95) / 60;
      p = 0.985 - 0.08 * hard - 0.09 * edge * edge - 0.02 * run;
    }
    return clamp(p + 0.02 * g, 0.3, 0.998);
  }

  /** The ball is on the ground: runners holding up (or waiting to tag) can go. */
  private ballDown(): void {
    for (const r of this.runners) {
      r.stopAt = null;
      if (r.waitCatch) {
        r.waitCatch = false;
        if (this.shouldAdvance(r, ADVANCE_MARGIN)) this.go(r, 0.1);
      }
    }
  }

  private tryField(): void {
    if (this.ball.kind !== 'path') return;
    const path = this.setup.path;
    const b = pathPositionAt(path, Math.min(this.t, path.duration));
    if (b.y > CATCH_HEIGHT) return;
    const air = this.t < path.landingTime;
    if (this.setup.foul && !air) return;
    if (!inPlayableArea(b)) return;
    let best = -1;
    let bestD = Infinity;
    let dive = false;
    this.fielders.forEach((f, i) => {
      if (this.t < f.reaction || this.t < f.missUntil || f.dive) return;
      // When you're fielding, teammates back you up instead of taking the ball.
      if (this.userIndex >= 0 && i !== this.userIndex && (air || this.t < path.landingTime + 1.5)) return;
      if (!this.canReachSpot(f, b, air)) return;
      const d = Math.hypot(b.x - f.x, b.z - f.z);
      const prev = f.lastBallD;
      f.lastBallD = d;
      if (d <= f.reach) {
        if (dive || d < bestD) {
          best = i;
          bestD = d;
          dive = false;
        }
        return;
      }
      // Just out of reach and getting away: lay out for it (the computer's fielders; you field on your feet).
      const canDive = i !== this.userIndex && f.role === 'chase' && b.y < 6 && d <= f.reach + DIVE_REACH;
      if (canDive && prev !== null && d > prev && best < 0) {
        best = i;
        bestD = d;
        dive = true;
      }
    });
    if (best < 0) return;
    const f = this.fielders[best];
    const ballSpeed = this.ballSpeedAt(this.t);
    const caught = this.rng.chance(this.catchChance(best, bestD, air, ballSpeed, b.y, dive));
    if (dive) {
      const len = Math.hypot(b.x - f.x, b.z - f.z) || 1;
      f.dive = { t0: this.t, dx: (b.x - f.x) / len, dz: (b.z - f.z) / len, caught };
      this.events.push({ type: 'dive', pos: f.pos, caught, time: this.t });
    }
    if (!caught) {
      if (dive || bestD / f.reach > 0.75) {
        // It gets past him.
        f.missUntil = this.t + 0.9;
        f.role = 'idle';
        f.target = null;
        this.events.push({ type: 'miss', pos: f.pos, time: this.t });
        this.rethink();
        if (air && this.t > path.landingTime - 0.3) this.ballDown();
        return;
      }
      // Bobbled (or dropped): the ball's on the ground next to him; he picks it up a moment later.
      const ang = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(1, 3);
      const loose = { kind: 'loose' as const, holder: best, x: b.x + Math.cos(ang) * r, z: b.z + Math.sin(ang) * r, pickAt: this.t + this.rng.range(0.6, 1.1), air };
      this.ball = loose;
      f.role = 'idle';
      f.target = { x: loose.x, z: loose.z };
      this.misplay = { pos: f.pos, air };
      this.events.push({ type: 'bobble', pos: f.pos, air, time: this.t });
      for (const x of this.fielders) {
        if (x.role === 'chase' && x !== f) {
          x.role = 'idle';
          x.target = null;
        }
      }
      this.ballDown();
      return;
    }
    const extra = dive ? DIVE_RECOVERY : 0;
    this.ball = { kind: 'held', holder: best, releaseAt: this.t + transferTime(f.pos) + extra + this.rng.range(-0.06, 0.1), decided: false, heldSince: this.t };
    this.chain.push(POSITION_NUMBER[f.pos]);
    this.events.push({ type: 'catch', pos: f.pos, air, time: this.t, dive });
    for (const x of this.fielders) {
      if (x.role === 'chase' && x !== f) {
        x.role = 'idle';
        x.target = null;
      }
    }
    f.role = 'idle';
    f.target = null;
    if (air) {
      this.caughtInAir = true;
      this.caughtBy = f.pos;
      const batter = this.runners.find((r) => r.isBatter)!;
      this.recordOut(batter, 1, false);
      // Runners who left early go back; tag-up runners may now go.
      for (const r of this.runners) {
        if (r.isBatter || r.state === 'out' || r.state === 'scored') continue;
        if (r.leftEarly && r.next !== null) {
          r.returning = true;
          r.stopAt = null;
          r.state = 'run';
          r.forced = false;
        }
        if (r.waitCatch) {
          r.waitCatch = false;
          if (this.shouldAdvance(r, ADVANCE_MARGIN)) this.go(r, 0.1);
        }
      }
    } else {
      this.fieldedBy = f.pos;
      if (this.setup.foul) return;
      // Ball down: runners who were holding up go.
      for (const r of this.runners) r.stopAt = null;
    }
  }

  // -------------------------------------------------------------------------
  // Throwing

  /** Time for the ball held by `h` to get to base b (run or throw). */
  private ballTimeTo(h: FState, b: number): { time: number; run: boolean } {
    const bp = basePos(b);
    const d = dist(h, bp);
    const runT = d / h.speed;
    const throwT = throwTime(d, h.arm);
    const release = this.ball.kind === 'held' ? Math.max(0, this.ball.releaseAt - this.t) : 0;
    if (d < 25 && runT <= release + throwT) return { time: runT, run: true };
    return { time: release + throwT, run: false };
  }

  private runnerTimeTo(r: RState, b: number): number {
    if (r.next === b) {
      const remaining = r.returning ? r.prog : 90 - r.prog;
      return Math.max(0, r.startAt - this.t) + remaining / r.speed;
    }
    return Infinity;
  }

  private decideThrow(holderIdx: number, forcedBase: number | null): void {
    const h = this.fielders[holderIdx];
    let choice: number | null = forcedBase;

    if (choice === null) {
      const twoOuts = this.startOuts + this.outsList.length === 2;
      let best: { base: number; score: number } | null = null;
      for (const r of this.runners) {
        if (r.state !== 'run' || r.next === null) continue;
        const b = r.returning ? r.base : r.next;
        const rt = r.returning ? Math.max(0, r.startAt - this.t) + r.prog / r.speed : this.runnerTimeTo(r, b);
        const bt = this.ballTimeTo(h, b).time;
        const margin = rt - bt;
        if (margin <= 0.05) continue;
        const force = !r.returning && r.forced && b === r.base + 1;
        // Lead runner first, but take the sure force (always with two outs).
        let score = b + (force ? 2 : 0) + (force && twoOuts ? 6 : 0);
        if (margin < 0.25) score -= 3;
        if (!best || score > best.score) best = { base: b, score };
      }
      if (best) choice = best.base;
      else if (OUTFIELD.includes(h.pos)) {
        // Can't get anyone: throw ahead of the lead runner to hold him.
        let lead: RState | null = null;
        for (const r of this.runners) if (r.state === 'run' && r.next !== null && !r.returning && (!lead || r.next > lead.next!)) lead = r;
        choice = lead ? Math.min(4, lead.next! + (lead.prog > 45 ? 1 : 0)) : 2;
        if (choice === 1) choice = 2;
      }
    }

    if (this.ball.kind === 'held') this.ball.decided = true;
    if (choice === null) return;
    const base = choice === 0 ? 4 : choice;
    const bt = this.ballTimeTo(h, base);
    if (bt.run) {
      h.target = this.coverSpot(base);
      h.role = 'cover';
      h.coverBase = base;
      return;
    }
    // Receiver: whoever is covering, else the nearest other fielder.
    let recv = this.fielders.findIndex((f, i) => i !== holderIdx && f.role === 'cover' && f.coverBase === base);
    if (recv < 0) {
      let bestD = Infinity;
      this.fielders.forEach((f, i) => {
        if (i === holderIdx) return;
        const d = dist(f, basePos(base));
        if (d < bestD) {
          bestD = d;
          recv = i;
        }
      });
      const rf = this.fielders[recv];
      rf.role = 'cover';
      rf.coverBase = base;
    }
    this.fielders[recv].target = this.coverSpot(base);
    this.throwTo(holderIdx, base, recv);
  }

  private throwTo(holderIdx: number, base: number, receiver: number): void {
    const h = this.fielders[holderIdx];
    const release = this.ball.kind === 'held' ? this.ball.releaseAt : this.t;
    const from = { x: h.x, y: 5.5, z: h.z };
    const d = dist(h, basePos(base));
    const t0 = Math.max(this.t, release);
    // Longer throws and weaker arms miss the target more often; a wide throw pulls the receiver off the bag.
    const pWide = clamp(0.012 + d * 0.00012 + (50 - h.armRating) * 0.0004, 0.004, 0.08);
    const wide = this.rng.chance(pWide);
    this.ball = { kind: 'thrown', from, base, receiver, t0, t1: t0 + throwTime(d, h.arm) + (wide ? 0.3 : 0), wide };
    h.role = 'idle';
    this.events.push({ type: 'throw', from: h.pos, to: base, time: t0 });
  }

  private updateBall(): void {
    const b = this.ball;
    if (b.kind === 'loose') {
      const h = this.fielders[b.holder];
      if (this.t >= b.pickAt && Math.hypot(h.x - b.x, h.z - b.z) <= h.reach + 1.5) {
        this.ball = { kind: 'held', holder: b.holder, releaseAt: this.t + transferTime(h.pos) * 0.7, decided: false, heldSince: this.t };
        this.chain.push(POSITION_NUMBER[h.pos]);
        this.fieldedBy = h.pos;
        this.events.push({ type: 'catch', pos: h.pos, air: false, time: this.t });
      }
      return;
    }
    if (b.kind === 'held') {
      const h = this.fielders[b.holder];
      // Tag / force at a base the holder is standing on.
      this.checkOutsAt(h, b.holder);
      if (this.done) return;
      if (this.t < b.releaseAt) return;
      if (b.holder === this.userIndex && this.setup.control) {
        const req = this.setup.control.takeThrow();
        if (req !== null) {
          this.decideThrow(b.holder, req);
          return;
        }
        if (this.t - b.heldSince < USER_THROW_TIMEOUT) return;
      }
      if (!b.decided) this.decideThrow(b.holder, null);
      else if (this.anyoneRunning()) {
        // Re-evaluate every so often (e.g. a runner tries to take an extra base).
        if (Math.round(this.t / PLAY_DT) % 12 === 0) {
          b.decided = false;
        }
      }
      return;
    }
    if (b.kind === 'thrown' && this.t >= b.t1) {
      const recv = this.fielders[b.receiver];
      if (dist(recv, basePos(b.base)) <= AT_BASE + 1) {
        this.ball = { kind: 'held', holder: b.receiver, releaseAt: this.t + 0.45 + (b.wide ? 0.3 : 0), decided: false, heldSince: this.t };
        this.chain.push(POSITION_NUMBER[recv.pos]);
        this.events.push({ type: 'catch', pos: recv.pos, air: false, time: this.t });
        if (b.wide) {
          recv.offBagUntil = this.t + 0.45;
          this.events.push({ type: 'wide', pos: recv.pos, time: this.t });
        } else this.checkOutsAt(recv, b.receiver);
      }
    }
  }

  private anyoneRunning(): boolean {
    return this.runners.some((r) => r.state === 'run');
  }

  /** A fielder holding the ball on a base retires any runner still heading there. */
  private checkOutsAt(h: FState, _idx: number): void {
    if (this.t < h.offBagUntil) return;
    for (let base = 1; base <= 4; base++) {
      if (dist(h, basePos(base)) > AT_BASE) continue;
      for (const r of this.runners) {
        if (r.state !== 'run') continue;
        const target = r.returning ? r.base : r.next;
        if (target === base || (base === 4 && target === 0)) {
          const force = !r.returning && r.forced && target === r.base + 1;
          this.recordOut(r, base, force || (r.isBatter && base === 1));
        }
      }
    }
  }

  private recordOut(r: RState, base: number, force: boolean): void {
    r.state = 'out';
    r.next = null;
    this.outsList.push({ runnerId: r.id, base, force, time: this.t });
    this.events.push({ type: 'out', runnerId: r.id, base, time: this.t });
    if (this.startOuts + this.outsList.length >= 3) this.finish();
  }

  // -------------------------------------------------------------------------
  // Running

  private ballEtaTo(base: number): number {
    const b = this.ball;
    if (b.kind === 'held') return this.ballTimeTo(this.fielders[b.holder], base).time;
    if (b.kind === 'loose') {
      const h = this.fielders[b.holder];
      return Math.max(0, b.pickAt - this.t) + transferTime(h.pos) * 0.7 + throwTime(dist(b, basePos(base)), h.arm);
    }
    if (b.kind === 'thrown') {
      const left = Math.max(0, b.t1 - this.t);
      if (b.base === base) return left;
      return left + 0.45 + throwTime(dist(basePos(b.base), basePos(base)), 120);
    }
    const f = this.bestChaser();
    if (!f || !f.intercept) return Infinity;
    const until = Math.max(0, f.intercept.t - this.t);
    return until + transferTime(f.pos) + throwTime(dist(f.intercept.p, basePos(base)), f.arm);
  }

  /** Should this runner try for the base after his next one? `lead` is his time left to reach his current target. */
  private shouldAdvance(r: RState, margin: number, lead = -1): boolean {
    const from = lead >= 0 && r.next !== null ? r.next : r.base;
    if (from >= 4) return false;
    const next = from + 1;
    if (next <= 3 && this.runners.some((o) => o !== r && o.state === 'safe' && o.base === next)) return false;
    const rt = 90 / r.speed + TURN_PENALTY + Math.max(0, lead);
    const bt = this.ballEtaTo(next);
    // The third-base coach is aggressive sending runners home.
    const m = next === 4 ? (this.startOuts + this.outsList.length === 2 ? -0.45 : -0.2) : margin;
    return rt + m < bt;
  }

  private moveRunners(dt: number): void {
    for (const r of this.runners) {
      if (r.state !== 'run' || r.next === null) {
        // Stopped runners may take off later (tag-ups, a throw going elsewhere).
        if (r.state === 'safe' && !r.waitCatch && !this.setup.foul && Math.round(this.t / PLAY_DT) % 15 === 0 && this.t > 0.5) {
          if (this.shouldAdvance(r, ADVANCE_MARGIN + 0.25)) this.go(r, 0.1);
        }
        continue;
      }
      if (this.t < r.startAt) continue;
      if (r.returning) {
        r.prog -= r.speed * dt;
        if (r.prog <= 0) {
          r.prog = 0;
          r.next = null;
          r.returning = false;
          r.state = 'safe';
          r.leftEarly = false;
        }
        continue;
      }
      if (r.stopAt !== null && r.prog >= r.stopAt) continue;
      const before = r.prog;
      r.prog += r.speed * dt;
      // Rounding the bag: decide on the extra base without stopping.
      if (before < 65 && r.prog >= 65 && r.next !== null && r.next < 4 && !this.isHomeRun && r.stopAt === null) {
        r.keepGoing = this.shouldAdvance(r, ADVANCE_MARGIN, (90 - r.prog) / r.speed);
      }
      if (r.prog >= 90) {
        r.base = r.next;
        r.prog = 0;
        r.next = null;
        r.forced = false;
        if (r.base >= 4) {
          r.state = 'scored';
          r.scoredAt = this.t;
          this.events.push({ type: 'score', runnerId: r.id, time: this.t });
          continue;
        }
        r.state = 'safe';
        // A trailing forced runner pushes this one on.
        const pushed = this.runners.some((o) => o !== r && o.state === 'run' && !o.returning && o.next === r.base);
        const keep = r.keepGoing && this.shouldAdvance(r, ADVANCE_MARGIN - 0.2);
        r.keepGoing = false;
        if (this.isHomeRun || keep) this.go(r, 0);
        else if (pushed || this.shouldAdvance(r, ADVANCE_MARGIN)) this.go(r, TURN_PENALTY);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Main loop

  step(dt = PLAY_DT): void {
    if (this.done) return;
    this.t += dt;

    if (this.t - this.lastRethink >= RETHINK_EVERY && this.ball.kind === 'path' && !this.isHomeRun) {
      this.rethink();
      this.lastRethink = this.t;
    }
    this.moveFielders(dt);
    this.tryField();
    if (this.done) return;
    this.updateBall();
    if (this.done) return;
    this.moveRunners(dt);
    this.checkEnd();
  }

  run(): PlayOutcome {
    while (!this.done) this.step();
    return this.result!;
  }

  private checkEnd(): void {
    const path = this.setup.path;
    if (this.setup.foul) {
      if (this.caughtInAir) {
        if (this.t > (this.ball.kind === 'held' ? this.ball.heldSince + 0.8 : 0)) this.finish();
      } else if (this.t >= path.landingTime || this.t >= path.duration) {
        this.finish();
      }
      return;
    }
    if (this.isHomeRun) {
      // Don't make everyone watch the whole trot: the play is over once the ball is gone.
      if (this.runners.every((r) => r.state === 'scored') || this.t > path.landingTime + 2.5) this.finish();
      return;
    }
    const secured = this.ball.kind === 'held';
    if (secured && !this.anyoneRunning() && this.t > (this.ball as { heldSince: number }).heldSince + 0.3) this.finish();
    if (this.t > MAX_PLAY_TIME) this.finish();
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.result = this.buildResult();
  }

  // -------------------------------------------------------------------------
  // Result

  private buildResult(): PlayOutcome {
    const s = this.setup;
    const bbType = battedBallType(s.path.init.launchAngleDeg);
    if (s.foul && !this.caughtInAir) return { kind: 'foul', description: 'fouls it off' };

    // Anyone still between bases goes back to (or on to) the nearest base.
    for (const r of this.runners) {
      if (r.state === 'run' && r.next !== null) {
        if (r.returning || r.prog < 45) {
          r.next = null;
        } else {
          r.base = r.next;
          r.next = null;
          if (r.base >= 4) {
            r.state = 'scored';
            r.scoredAt = this.t;
            continue;
          }
        }
        r.state = 'safe';
        r.prog = 0;
      }
    }

    if (this.isHomeRun) {
      for (const r of this.runners) {
        if (r.state !== 'scored') {
          r.state = 'scored';
          r.scoredAt = this.t;
        }
      }
    }

    const totalOuts = this.startOuts + this.outsList.length;
    let scored = this.runners.filter((r) => r.state === 'scored');
    if (totalOuts >= 3) {
      const third = this.outsList[2 - this.startOuts];
      if (third && third.force) scored = [];
      else if (third) scored = scored.filter((r) => r.scoredAt <= third.time);
    }

    const batter = this.runners.find((r) => r.isBatter)!;
    const forceOutOnOther = this.outsList.some((o) => o.runnerId !== batter.id && o.force);
    let batterResult: BatterResult;
    let outKind: OutKind | undefined;
    if (batter.state === 'out') {
      batterResult = 'out';
      if (this.caughtInAir) outKind = s.foul ? 'foulout' : bbType === 'ground ball' || bbType === 'line drive' ? 'lineout' : bbType === 'pop up' ? 'popout' : 'flyout';
      else outKind = 'groundout';
    } else if (this.isHomeRun || batter.state === 'scored') {
      batterResult = 'homeRun';
    } else if (forceOutOnOther) {
      batterResult = 'fc';
      outKind = 'forceout';
    } else {
      batterResult = batter.base >= 3 ? 'triple' : batter.base === 2 ? 'double' : 'single';
    }

    const bases: PlayResult['bases'] = [null, null, null];
    for (const r of this.runners) if (r.state === 'safe' && r.base >= 1 && r.base <= 3) bases[r.base - 1] = r.id;

    const sacFly = this.caughtInAir && !s.foul && scored.length > 0 && this.startOuts < 2;
    const doublePlay = this.outsList.length >= 2;
    const desc = this.describe(batterResult, outKind, bbType, doublePlay, sacFly);
    return {
      kind: 'play',
      batterResult,
      outKind,
      outs: this.outsList,
      scored: scored.map((r) => r.id),
      bases,
      sacFly,
      doublePlay,
      battedBallType: bbType,
      description: desc,
      chain: this.chain,
    };
  }

  private describe(res: BatterResult, outKind: OutKind | undefined, bb: BattedBallType, dp: boolean, sacFly: boolean): string {
    const spray = this.caughtBy || this.fieldedBy ? null : sprayOf(this.setup.path.landing);
    const where = (): string => {
      const pos = this.caughtBy ?? this.fieldedBy;
      const angle = spray ?? this.setup.path.init.sprayDeg;
      if (pos && OUTFIELD.includes(pos)) return { LF: 'to left', CF: 'to center', RF: 'to right' }[pos as 'LF' | 'CF' | 'RF'];
      if (pos && INFIELD.includes(pos)) return angle < -8 ? 'to the left side' : angle > 8 ? 'to the right side' : 'up the middle';
      return angle < -15 ? 'to left' : angle > 15 ? 'to right' : 'to center';
    };
    const chain = this.chain.join('-');
    const fielder = (this.caughtBy ?? this.fieldedBy) as FieldPosition | null;
    switch (res) {
      case 'homeRun':
        return this.setup.path.homeRun ? `homers ${where()} (${Math.round(this.setup.path.distance)} ft)` : 'circles the bases for an inside-the-park home run';
      case 'triple':
        return `triples ${where()}`;
      case 'double':
        return `doubles ${where()}`;
      case 'single':
        if (this.misplay) return this.misplay.air ? `reaches when the ${this.misplay.pos} drops the ball` : `reaches as the ${this.misplay.pos} bobbles it`;
        return `singles ${where()}`;
      case 'fc':
        return dp ? `reaches on a fielder's choice (${chain})` : `reaches on a fielder's choice, ${chain}`;
      case 'out':
        if (dp) return this.caughtInAir ? `lines into a double play, ${chain}` : `grounds into a double play, ${chain}`;
        if (sacFly) return `hits a sacrifice fly to ${fielder ?? 'the outfield'}`;
        if (outKind === 'groundout') return `grounds out, ${chain}`;
        if (outKind === 'foulout') return `fouls out to ${fielder}`;
        if (outKind === 'popout') return `pops out to ${fielder}`;
        if (outKind === 'lineout') return `lines out to ${fielder}`;
        return bb === 'fly ball' ? `flies out to ${fielder}` : `flies out to ${fielder}`;
    }
  }
}

/** Convenience: simulate a whole play headlessly. */
export function simulatePlay(setup: PlaySetup): PlayOutcome {
  return new PlaySim(setup).run();
}

/** Is a fielder standing here clear of the walls (with a little room to spare)? */
function insideWalls(x: number, z: number): boolean {
  // Check a point a few feet further out from the middle of the field.
  const cx = x;
  const cz = z + 150;
  const len = Math.hypot(cx, cz) || 1;
  return inPlayableArea({ x: x + (cx / len) * 3, z: z + (cz / len) * 3 });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** A repeatable seed from the ball's path, so the same batted ball plays out the same way. */
function pathSeed(path: BattedBallPath): number {
  const a = Math.round(path.landing.x * 97) | 0;
  const b = Math.round(path.landing.z * 89) | 0;
  const c = Math.round(path.duration * 1009) | 0;
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b + 0x7f4a7c15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (c + 0x165667b1), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
