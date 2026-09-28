import type { FieldingRatings, FieldPosition } from '../core/types';
import { FIELD_POSITIONS, POSITION_NUMBER } from '../core/types';
import type { Vec3 } from '../core/types';
import { pathPositionAt, sprayOf, type BattedBallPath } from './battedBall';
import { fenceDistance } from '../core/constants';
import { BASES, dist, FIELD_SPOTS, inPlayableArea, type XZ } from './field';
import { battedBallType, type BattedBallType } from './outcome';

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
const MAX_PLAY_TIME = 30;

const INFIELD: FieldPosition[] = ['1B', '2B', 'SS', '3B'];
const OUTFIELD: FieldPosition[] = ['LF', 'CF', 'RF'];

export function runSpeed(speedRating: number): number {
  return 23 + speedRating * 0.07;
}

/** Fielders' effective chase speed (ft/s) - routes and first steps make it slower than a sprint. */
export function fieldSpeed(speedRating: number): number {
  return 19 + speedRating * 0.08;
}

/** Long throws lose speed (arc, maybe a hop). */
function throwTime(d: number, arm: number): number {
  return (d / arm) * (1 + Math.max(0, d - 150) / 600);
}

export function throwSpeed(armRating: number): number {
  return 92 + armRating * 0.48;
}

function reactionTime(pos: FieldPosition, glove: number): number {
  // Includes the time to get up to speed.
  const base = OUTFIELD.includes(pos) ? 0.8 : pos === 'P' || pos === 'C' ? 0.45 : 0.34;
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
  | { type: 'catch'; pos: FieldPosition; air: boolean; time: number }
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
  arm: number;
  reaction: number;
  reach: number;
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
  | { kind: 'thrown'; from: Vec3; base: number; receiver: number; t0: number; t1: number };

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

  constructor(setup: PlaySetup) {
    this.setup = setup;
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
        arm: throwSpeed(f.fielding.arm),
        reaction: reactionTime(pos, f.fielding.glove),
        reach: reach(f.fielding.glove),
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
      const d = Math.max(0, Math.hypot(p.x - f.x, p.z - f.z) - f.reach);
      // Infielders can only lunge at line drives; they don't get to run them down.
      const lunge = air && !OUTFIELD.includes(f.pos) && p.y < 12 && ts - this.t < 1.2 ? 0.35 : 0;
      if (react + lunge + d / f.speed <= ts - this.t) return { t: ts, p: { x: p.x, z: p.z }, air };
    }
    if (this.setup.foul) return null;
    // The ball has stopped: go get it.
    const last = path.points[path.points.length - 1];
    if (!inPlayableArea(last) || !this.canReachSpot(f, last, false)) return null;
    const d = Math.max(0, Math.hypot(last.x - f.x, last.z - f.z) - f.reach);
    return { t: Math.max(end, this.t + react + d / f.speed), p: { x: last.x, z: last.z }, air: false };
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
      let vx = 0;
      let vz = 0;
      if (i === this.userIndex && this.setup.control && !(this.ball.kind === 'held' && holding && this.t < (this.ball as { releaseAt: number }).releaseAt)) {
        const m = this.setup.control.move();
        const len = Math.hypot(m.x, m.z);
        if (len > 0.01 && this.t >= f.reaction * 0.5) {
          const k = Math.min(1, len) / len;
          vx = m.x * k * f.speed;
          vz = m.z * k * f.speed;
        }
      } else if (f.target && this.t >= f.reaction && !holding) {
        const dx = f.target.x - f.x;
        const dz = f.target.z - f.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.3) {
          const sp = Math.min(f.speed, d / dt);
          vx = (dx / d) * sp;
          vz = (dz / d) * sp;
        }
      }
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
    this.fielders.forEach((f, i) => {
      if (this.t < f.reaction) return;
      // When you're fielding, teammates back you up instead of taking the ball.
      if (this.userIndex >= 0 && i !== this.userIndex && (air || this.t < path.landingTime + 1.5)) return;
      const d = Math.hypot(b.x - f.x, b.z - f.z);
      if (d <= f.reach && d < bestD && this.canReachSpot(f, b, air)) {
        best = i;
        bestD = d;
      }
    });
    if (best < 0) return;
    const f = this.fielders[best];
    this.ball = { kind: 'held', holder: best, releaseAt: this.t + transferTime(f.pos), decided: false, heldSince: this.t };
    this.chain.push(POSITION_NUMBER[f.pos]);
    this.events.push({ type: 'catch', pos: f.pos, air, time: this.t });
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
    this.ball = { kind: 'thrown', from, base, receiver, t0, t1: t0 + throwTime(d, h.arm) };
    h.role = 'idle';
    this.events.push({ type: 'throw', from: h.pos, to: base, time: t0 });
  }

  private updateBall(): void {
    const b = this.ball;
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
        this.ball = { kind: 'held', holder: b.receiver, releaseAt: this.t + 0.45, decided: false, heldSince: this.t };
        this.chain.push(POSITION_NUMBER[recv.pos]);
        this.events.push({ type: 'catch', pos: recv.pos, air: false, time: this.t });
        this.checkOutsAt(recv, b.receiver);
      }
    }
  }

  private anyoneRunning(): boolean {
    return this.runners.some((r) => r.state === 'run');
  }

  /** A fielder holding the ball on a base retires any runner still heading there. */
  private checkOutsAt(h: FState, _idx: number): void {
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
