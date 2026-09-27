import { describe, expect, it } from 'vitest';
import { advanceOnWalk, applyPitch, newGameState, type GameState, type PitchEvent } from '../src/sim/atBat';
import type { PlayResult } from '../src/sim/playSim';

const run = (events: PitchEvent[], s: GameState = newGameState()) => {
  let last = { state: s } as ReturnType<typeof applyPitch>;
  for (const e of events) last = applyPitch(last.state, e, 'B');
  return last;
};

const play = (p: Partial<PlayResult>): PitchEvent => ({
  type: 'inPlay',
  exitVeloMph: 95,
  play: {
    kind: 'play',
    batterResult: 'single',
    outs: [],
    scored: [],
    bases: ['B', null, null],
    sacFly: false,
    doublePlay: false,
    battedBallType: 'line drive',
    description: 'singles to left',
    chain: [7],
    ...p,
  },
});

const ball: PitchEvent = { type: 'ball' };
const strike: PitchEvent = { type: 'calledStrike' };
const whiff: PitchEvent = { type: 'swingingStrike' };
const foul: PitchEvent = { type: 'foul' };

describe('at-bat engine', () => {
  it('four balls is a walk', () => {
    const r = run([ball, ball, ball, ball]);
    expect(r.pa).toBe('walk');
    expect(r.state.bases).toEqual(['B', null, null]);
    expect(r.state.batting.bb).toBe(1);
    expect(r.state.batting.ab).toBe(0);
  });

  it('three strikes is a strikeout and an out', () => {
    const r = run([strike, whiff, strike]);
    expect(r.pa).toBe('strikeout');
    expect(r.state.outs).toBe(1);
    expect(r.state.pitching.k).toBe(1);
  });

  it('a foul with two strikes does not add a strike', () => {
    const r = run([strike, strike, foul, foul, foul]);
    expect(r.pa).toBeUndefined();
    expect(r.state.count).toEqual({ balls: 0, strikes: 2 });
  });

  it('three outs ends the inning and the next pitch starts a new one', () => {
    const k = [strike, strike, strike];
    const r = run([...k, ...k, ...k]);
    expect(r.inningOver).toBe(true);
    const next = applyPitch(r.state, ball);
    expect(next.state.inning).toBe(2);
    expect(next.state.outs).toBe(0);
  });

  it('walks force runners and a bases-loaded walk scores a run', () => {
    expect(advanceOnWalk([null, 'A', null], 'B')).toEqual([['B', 'A', null], []]);
    expect(advanceOnWalk(['A', null, 'C'], 'B')).toEqual([['B', 'A', 'C'], []]);
    expect(advanceOnWalk(['A', 'X', 'C'], 'B')).toEqual([['B', 'A', 'X'], ['C']]);
  });

  it('applies the play result: bases, runs, hits and RBI', () => {
    const r = run([play({ batterResult: 'double', bases: [null, 'B', null], scored: ['R1'] })]);
    expect(r.state.bases).toEqual([null, 'B', null]);
    expect(r.state.runs).toBe(1);
    expect(r.state.batting.h).toBe(1);
    expect(r.state.batting.doubles).toBe(1);
    expect(r.state.batting.rbi).toBe(1);
    expect(r.scorers).toEqual(['R1']);
  });

  it('a sacrifice fly is not an at-bat and a double play gives no RBI', () => {
    const sf = run([play({ batterResult: 'out', outs: [{ runnerId: 'B', base: 1, force: false, time: 3 }], scored: ['R3'], sacFly: true, bases: [null, null, null] })]);
    expect(sf.state.batting.ab).toBe(0);
    expect(sf.state.batting.rbi).toBe(1);
    const dp = run([
      play({
        batterResult: 'out',
        doublePlay: true,
        outs: [
          { runnerId: 'R1', base: 2, force: true, time: 2 },
          { runnerId: 'B', base: 1, force: true, time: 3 },
        ],
        scored: ['R3'],
        bases: [null, null, null],
      }),
    ]);
    expect(dp.state.outs).toBe(2);
    expect(dp.state.batting.rbi).toBe(0);
    expect(dp.state.runs).toBe(1);
  });
});
