import type { Bases, Count } from '../core/types';
import type { BallInPlayOutcome, HitResult } from './outcome';

export type PitchEvent =
  | { type: 'ball' }
  | { type: 'calledStrike' }
  | { type: 'swingingStrike' }
  | { type: 'foul' }
  | { type: 'inPlay'; outcome: BallInPlayOutcome; exitVeloMph: number };

export type PlateAppearanceResult =
  | 'strikeout'
  | 'walk'
  | HitResult
  | 'out';

export interface BattingLine {
  pa: number;
  ab: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  bb: number;
  k: number;
  rbi: number;
  maxEv: number;
}

export interface PitchingLine {
  pitches: number;
  strikes: number;
  outs: number;
  h: number;
  bb: number;
  k: number;
  hr: number;
  r: number;
}

export interface GameState {
  inning: number;
  outs: number;
  count: Count;
  bases: Bases;
  runs: number;
  batting: BattingLine;
  pitching: PitchingLine;
}

export interface PitchOutcome {
  state: GameState;
  /** Set when the plate appearance ended on this pitch. */
  pa?: PlateAppearanceResult;
  runsScored: number;
  /** True when this pitch made the third out (the next PA starts a new inning). */
  inningOver: boolean;
  description: string;
}

export function emptyBattingLine(): BattingLine {
  return { pa: 0, ab: 0, h: 0, doubles: 0, triples: 0, hr: 0, bb: 0, k: 0, rbi: 0, maxEv: 0 };
}

export function emptyPitchingLine(): PitchingLine {
  return { pitches: 0, strikes: 0, outs: 0, h: 0, bb: 0, k: 0, hr: 0, r: 0 };
}

export function newGameState(): GameState {
  return {
    inning: 1,
    outs: 0,
    count: { balls: 0, strikes: 0 },
    bases: [false, false, false],
    runs: 0,
    batting: emptyBattingLine(),
    pitching: emptyPitchingLine(),
  };
}

/** Advance runners for a hit. Returns [new bases, runs scored] (batter included). */
export function advanceOnHit(bases: Bases, hit: HitResult): [Bases, number] {
  const [on1, on2, on3] = bases;
  const n = (b: boolean) => (b ? 1 : 0);
  switch (hit) {
    case 'single':
      // Runners on 2nd and 3rd score; runner on 1st goes to 2nd.
      return [[true, on1, false], n(on2) + n(on3)];
    case 'double':
      // Everyone from 2nd scores, runner on 1st to 3rd.
      return [[false, true, on1], n(on2) + n(on3)];
    case 'triple':
      return [[false, false, true], n(on1) + n(on2) + n(on3)];
    case 'homeRun':
      return [[false, false, false], n(on1) + n(on2) + n(on3) + 1];
  }
}

/** Force runners on a walk. */
export function advanceOnWalk(bases: Bases): [Bases, number] {
  const [on1, on2, on3] = bases;
  if (!on1) return [[true, on2, on3], 0];
  if (!on2) return [[true, true, on3], 0];
  if (!on3) return [[true, true, true], 0];
  return [[true, true, true], 1];
}

function clone(s: GameState): GameState {
  return {
    ...s,
    count: { ...s.count },
    bases: [...s.bases] as Bases,
    batting: { ...s.batting },
    pitching: { ...s.pitching },
  };
}

/** Apply one pitch to the game state. Pure: returns a new state. */
export function applyPitch(prev: GameState, ev: PitchEvent): PitchOutcome {
  // A new inning starts on the first pitch after the third out.
  let s = clone(prev);
  if (s.outs >= 3) {
    s.inning += 1;
    s.outs = 0;
    s.bases = [false, false, false];
  }
  s.pitching.pitches += 1;
  if (ev.type !== 'ball') s.pitching.strikes += 1;

  let pa: PlateAppearanceResult | undefined;
  let runs = 0;
  let description = '';

  const endPa = (result: PlateAppearanceResult) => {
    pa = result;
    s.count = { balls: 0, strikes: 0 };
    s.batting.pa += 1;
    if (result !== 'walk') s.batting.ab += 1;
  };

  const recordOut = () => {
    s.outs += 1;
    s.pitching.outs += 1;
  };

  switch (ev.type) {
    case 'ball':
      s.count.balls += 1;
      description = 'Ball';
      if (s.count.balls >= 4) {
        const [bases, r] = advanceOnWalk(s.bases);
        s.bases = bases;
        runs = r;
        s.batting.bb += 1;
        s.pitching.bb += 1;
        endPa('walk');
        description = 'Ball four — walk';
      }
      break;
    case 'calledStrike':
    case 'swingingStrike':
      s.count.strikes += 1;
      description = ev.type === 'calledStrike' ? 'Called strike' : 'Swinging strike';
      if (s.count.strikes >= 3) {
        s.batting.k += 1;
        s.pitching.k += 1;
        recordOut();
        endPa('strikeout');
        description = ev.type === 'calledStrike' ? 'Strike three — called' : 'Strike three — swinging';
      }
      break;
    case 'foul':
      if (s.count.strikes < 2) s.count.strikes += 1;
      description = 'Foul ball';
      break;
    case 'inPlay': {
      const o = ev.outcome;
      s.batting.maxEv = Math.max(s.batting.maxEv, ev.exitVeloMph);
      if (o.kind === 'foul') {
        if (s.count.strikes < 2) s.count.strikes += 1;
        description = 'Foul ball';
        break;
      }
      if (o.kind === 'hit') {
        const [bases, r] = advanceOnHit(s.bases, o.hit);
        s.bases = bases;
        runs = r;
        s.batting.h += 1;
        s.pitching.h += 1;
        if (o.hit === 'double') s.batting.doubles += 1;
        if (o.hit === 'triple') s.batting.triples += 1;
        if (o.hit === 'homeRun') {
          s.batting.hr += 1;
          s.pitching.hr += 1;
        }
        endPa(o.hit);
        description = o.label;
      } else {
        recordOut();
        // Sacrifice fly: a deep enough fly/line out with fewer than 3 outs scores the runner from third.
        if (o.sacFlyDepth && s.outs < 3 && s.bases[2]) {
          s.bases[2] = false;
          runs = 1;
          description = 'Sacrifice fly';
        } else {
          description = o.label;
        }
        endPa('out');
        if (runs > 0) s.batting.ab -= 1; // sac flies are not at-bats
      }
      break;
    }
  }

  s.runs += runs;
  s.batting.rbi += runs;
  s.pitching.r += runs;

  return { state: s, pa, runsScored: runs, inningOver: s.outs >= 3, description };
}

export function battingAverage(line: BattingLine): string {
  if (line.ab === 0) return '.000';
  const avg = line.h / line.ab;
  return avg >= 1 ? '1.000' : avg.toFixed(3).slice(1);
}

export function inningsPitched(line: PitchingLine): string {
  return `${Math.floor(line.outs / 3)}.${line.outs % 3}`;
}
