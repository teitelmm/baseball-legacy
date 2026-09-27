import type { Count } from '../core/types';
import type { PlayResult } from './playSim';

/** Runner ids on first, second, third. */
export type BaseRunners = [string | null, string | null, string | null];

export type PitchEvent =
  | { type: 'ball' }
  | { type: 'calledStrike' }
  | { type: 'swingingStrike' }
  | { type: 'foul' }
  | { type: 'inPlay'; play: PlayResult; exitVeloMph: number };

export type PlateAppearanceResult = 'strikeout' | 'walk' | 'single' | 'double' | 'triple' | 'homeRun' | 'out' | 'fc';

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
  bases: BaseRunners;
  runs: number;
  batting: BattingLine;
  pitching: PitchingLine;
}

export interface PitchOutcome {
  state: GameState;
  /** Set when the plate appearance ended on this pitch. */
  pa?: PlateAppearanceResult;
  runsScored: number;
  /** Ids of runners who scored on this pitch. */
  scorers: string[];
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
    bases: [null, null, null],
    runs: 0,
    batting: emptyBattingLine(),
    pitching: emptyPitchingLine(),
  };
}

/** Force runners on a walk. Returns [new bases, ids of runners forced home]. */
export function advanceOnWalk(bases: BaseRunners, batterId: string): [BaseRunners, string[]] {
  const [on1, on2, on3] = bases;
  if (!on1) return [[batterId, on2, on3], []];
  if (!on2) return [[batterId, on1, on3], []];
  if (!on3) return [[batterId, on1, on2], []];
  return [[batterId, on1, on2], [on3]];
}

function clone(s: GameState): GameState {
  return {
    ...s,
    count: { ...s.count },
    bases: [...s.bases] as BaseRunners,
    batting: { ...s.batting },
    pitching: { ...s.pitching },
  };
}

const PA_FROM_PLAY: Record<PlayResult['batterResult'], PlateAppearanceResult> = {
  single: 'single',
  double: 'double',
  triple: 'triple',
  homeRun: 'homeRun',
  out: 'out',
  fc: 'fc',
};

/** Apply one pitch to the game state. Pure: returns a new state. */
export function applyPitch(prev: GameState, ev: PitchEvent, batterId = 'batter'): PitchOutcome {
  // A new inning starts on the first pitch after the third out.
  const s = clone(prev);
  if (s.outs >= 3) {
    s.inning += 1;
    s.outs = 0;
    s.bases = [null, null, null];
  }
  s.pitching.pitches += 1;
  if (ev.type !== 'ball') s.pitching.strikes += 1;

  let pa: PlateAppearanceResult | undefined;
  let scorers: string[] = [];
  let description = '';

  const endPa = (result: PlateAppearanceResult, atBat = true) => {
    pa = result;
    s.count = { balls: 0, strikes: 0 };
    s.batting.pa += 1;
    if (atBat) s.batting.ab += 1;
  };

  switch (ev.type) {
    case 'ball':
      s.count.balls += 1;
      description = 'Ball';
      if (s.count.balls >= 4) {
        const [bases, home] = advanceOnWalk(s.bases, batterId);
        s.bases = bases;
        scorers = home;
        s.batting.bb += 1;
        s.pitching.bb += 1;
        endPa('walk', false);
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
        s.outs += 1;
        s.pitching.outs += 1;
        endPa('strikeout');
        description = ev.type === 'calledStrike' ? 'Strike three — called' : 'Strike three — swinging';
      }
      break;
    case 'foul':
      if (s.count.strikes < 2) s.count.strikes += 1;
      description = 'Foul ball';
      break;
    case 'inPlay': {
      const p = ev.play;
      s.batting.maxEv = Math.max(s.batting.maxEv, ev.exitVeloMph);
      const outs = Math.min(p.outs.length, 3 - s.outs);
      s.outs += outs;
      s.pitching.outs += outs;
      s.bases = s.outs >= 3 ? [null, null, null] : [...p.bases];
      scorers = [...p.scored];
      const result = PA_FROM_PLAY[p.batterResult];
      const isHit = result === 'single' || result === 'double' || result === 'triple' || result === 'homeRun';
      if (isHit) {
        s.batting.h += 1;
        s.pitching.h += 1;
        if (result === 'double') s.batting.doubles += 1;
        if (result === 'triple') s.batting.triples += 1;
        if (result === 'homeRun') {
          s.batting.hr += 1;
          s.pitching.hr += 1;
        }
      }
      // Sacrifice flies are not at-bats.
      endPa(result, !p.sacFly);
      description = p.description;
      break;
    }
  }

  const runs = scorers.length;
  s.runs += runs;
  // No RBI on a double play.
  if (!(ev.type === 'inPlay' && ev.play.doublePlay)) s.batting.rbi += runs;
  s.pitching.r += runs;

  return { state: s, pa, runsScored: runs, scorers, inningOver: s.outs >= 3, description };
}

export function battingAverage(line: BattingLine): string {
  if (line.ab === 0) return '.000';
  const avg = line.h / line.ab;
  return avg >= 1 ? '1.000' : avg.toFixed(3).slice(1);
}

export function inningsPitched(line: PitchingLine): string {
  return `${Math.floor(line.outs / 3)}.${line.outs % 3}`;
}
