import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import type { Batter, Pitcher } from '../src/core/types';
import { decideCpuSwing } from '../src/sim/ai/cpuBatter';
import { planCpuPitch } from '../src/sim/ai/cpuPitcher';
import { buildPitch } from '../src/sim/pitchPhysics';
import { isStrike } from '../src/sim/zone';

const pitcher: Pitcher = { name: 'CPU', throws: 'R', ratings: { velocity: 70, control: 70, movement: 70 }, repertoire: ['FF', 'SL', 'CH'] };
const batter: Batter = { name: 'CPU', bats: 'R', ratings: { contact: 70, power: 70, eye: 70 } };

describe('CPU AI', () => {
  it('pitcher throws more strikes when behind in the count', () => {
    const rng = new Rng(11);
    const rate = (balls: number, strikes: number) => {
      let n = 0;
      for (let i = 0; i < 500; i++) if (isStrike(planCpuPitch(pitcher, { balls, strikes }, 'R', rng).spec.plateLoc)) n++;
      return n / 500;
    };
    expect(rate(3, 0)).toBeGreaterThan(rate(0, 2) + 0.2);
  });

  it('pitcher only throws pitches from its repertoire at sensible speeds', () => {
    const rng = new Rng(12);
    for (let i = 0; i < 200; i++) {
      const plan = planCpuPitch(pitcher, { balls: 1, strikes: 1 }, 'L', rng);
      expect(pitcher.repertoire).toContain(plan.spec.type);
      expect(plan.spec.speedMph).toBeGreaterThan(70);
      expect(plan.spec.speedMph).toBeLessThan(102);
    }
  });

  it('batter swings at strikes far more than at balls in the dirt', () => {
    const rng = new Rng(13);
    const strike = buildPitch({ type: 'FF', throws: 'R', speedMph: 93, plateLoc: { x: 0, y: 2.5 } });
    const dirt = buildPitch({ type: 'FF', throws: 'R', speedMph: 93, plateLoc: { x: 0, y: 0.6 } });
    let s = 0;
    let d = 0;
    for (let i = 0; i < 300; i++) {
      if (decideCpuSwing(batter, strike, { balls: 1, strikes: 1 }, null, rng).swing) s++;
      if (decideCpuSwing(batter, dirt, { balls: 1, strikes: 1 }, null, rng).swing) d++;
    }
    expect(s / 300).toBeGreaterThan(0.6);
    expect(d / 300).toBeLessThan(0.15);
  });

  it('a changeup after a fastball gets the batter out in front', () => {
    const rng = new Rng(14);
    const ch = buildPitch({ type: 'CH', throws: 'R', speedMph: 83, plateLoc: { x: 0, y: 2.4 } });
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const d = decideCpuSwing(batter, ch, { balls: 1, strikes: 1 }, 96, rng);
      if (d.input) {
        sum += d.input.timingErrorMs;
        n++;
      }
    }
    expect(sum / n).toBeLessThan(-15);
  });

  it('a zone bias makes the pitcher throw more strikes', () => {
    const rate = (bias: number) => {
      const rng = new Rng(21);
      let n = 0;
      for (let i = 0; i < 600; i++) if (isStrike(planCpuPitch(pitcher, { balls: 0, strikes: 1 }, 'R', rng, bias).spec.plateLoc)) n++;
      return n / 600;
    };
    expect(rate(0.2)).toBeGreaterThan(rate(0) + 0.1);
  });
});
