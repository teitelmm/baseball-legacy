import { describe, expect, it } from 'vitest';
import { advanceOnHit, advanceOnWalk, applyPitch, newGameState, type GameState, type PitchEvent } from '../src/sim/atBat';

const run = (events: PitchEvent[], s: GameState = newGameState()) => {
  let last = { state: s } as ReturnType<typeof applyPitch>;
  for (const e of events) last = applyPitch(last.state, e);
  return last;
};

const ball: PitchEvent = { type: 'ball' };
const strike: PitchEvent = { type: 'calledStrike' };
const whiff: PitchEvent = { type: 'swingingStrike' };
const foul: PitchEvent = { type: 'foul' };
const single: PitchEvent = { type: 'inPlay', exitVeloMph: 95, outcome: { kind: 'hit', hit: 'single', label: 'Single', battedBallType: 'line drive' } };
const homer: PitchEvent = { type: 'inPlay', exitVeloMph: 108, outcome: { kind: 'hit', hit: 'homeRun', label: 'HR', battedBallType: 'fly ball' } };
const deepFly: PitchEvent = { type: 'inPlay', exitVeloMph: 98, outcome: { kind: 'out', out: 'flyout', label: 'Fly out', battedBallType: 'fly ball', sacFlyDepth: true } };

describe('at-bat engine', () => {
  it('four balls is a walk', () => {
    const r = run([ball, ball, ball, ball]);
    expect(r.pa).toBe('walk');
    expect(r.state.bases).toEqual([true, false, false]);
    expect(r.state.count).toEqual({ balls: 0, strikes: 0 });
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
    expect(r.state.outs).toBe(3);
    const next = applyPitch(r.state, ball);
    expect(next.state.inning).toBe(2);
    expect(next.state.outs).toBe(0);
  });

  it('walks force runners and a bases-loaded walk scores a run', () => {
    expect(advanceOnWalk([false, true, false])).toEqual([[true, true, false], 0]);
    expect(advanceOnWalk([true, false, true])).toEqual([[true, true, true], 0]);
    expect(advanceOnWalk([true, true, true])).toEqual([[true, true, true], 1]);
  });

  it('hits advance runners and score runs', () => {
    expect(advanceOnHit([true, true, true], 'single')).toEqual([[true, true, false], 2]);
    expect(advanceOnHit([true, false, false], 'double')).toEqual([[false, true, true], 0]);
    expect(advanceOnHit([true, true, true], 'homeRun')).toEqual([[false, false, false], 4]);
    const r = run([single, single, homer]);
    expect(r.state.runs).toBe(3);
    expect(r.state.batting.hr).toBe(1);
    expect(r.state.batting.rbi).toBe(3);
  });

  it('a deep fly with a runner on third and < 2 outs is a sacrifice fly', () => {
    const s = newGameState();
    s.bases = [false, false, true];
    const r = applyPitch(s, deepFly);
    expect(r.runsScored).toBe(1);
    expect(r.state.outs).toBe(1);
    expect(r.state.batting.ab).toBe(0);
    expect(r.description).toBe('Sacrifice fly');
  });
});
