import { describe, expect, it } from 'vitest';
import { fenceDistance } from '../src/core/constants';
import { Rng } from '../src/core/rng';
import { simulateBattedBall } from '../src/sim/battedBall';
import { classifyBattedBall } from '../src/sim/outcome';

const hit = (ev: number, la: number, spray = 0) =>
  simulateBattedBall({ exitVeloMph: ev, launchAngleDeg: la, sprayDeg: spray, start: { x: 0, y: 3, z: 0 } });

describe('batted ball flight', () => {
  it('fence is 330 down the lines, 375 in the gaps, 400 to center', () => {
    expect(fenceDistance(0)).toBeCloseTo(400);
    expect(fenceDistance(-22.5)).toBeCloseTo(375);
    expect(fenceDistance(45)).toBeCloseTo(330);
  });

  it('105 mph at 28 degrees carries about 400 ft', () => {
    const p = hit(105, 28, 10);
    expect(p.distance).toBeGreaterThan(375);
    expect(p.distance).toBeLessThan(430);
  });

  it('90 mph at 30 degrees is a routine fly ball', () => {
    const p = hit(90, 30);
    expect(p.distance).toBeGreaterThan(300);
    expect(p.distance).toBeLessThan(360);
    expect(p.homeRun).toBe(false);
  });

  it('110 mph at 28 degrees is a home run', () => {
    const p = hit(110, 28, -15);
    expect(p.homeRun).toBe(true);
    expect(classifyBattedBall(p, new Rng(1))).toMatchObject({ kind: 'hit', hit: 'homeRun' });
  });

  it('ground balls land short and pop ups hang', () => {
    expect(hit(95, -5).distance).toBeLessThan(60);
    const pop = hit(75, 65);
    expect(pop.landingTime).toBeGreaterThan(4);
    expect(pop.distance).toBeLessThan(200);
  });

  it('balls outside the foul lines are foul', () => {
    expect(classifyBattedBall(hit(100, 20, 55), new Rng(2)).kind).toBe('foul');
    expect(classifyBattedBall(hit(100, 5, -50), new Rng(2)).kind).toBe('foul');
  });

  it('pop ups are almost always outs', () => {
    const rng = new Rng(3);
    let outs = 0;
    for (let i = 0; i < 100; i++) if (classifyBattedBall(hit(80, 60, 5), rng).kind === 'out') outs++;
    expect(outs).toBeGreaterThan(90);
  });
});
