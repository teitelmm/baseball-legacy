import { describe, expect, it } from 'vitest';
import { effortBonusMph, LATE_LIMIT, MAX_POWER, missInches, PitchMeter, RISE_RATE } from '../src/sim/pitchMeter';

describe('pitch meter', () => {
  it('rises, sets power, then falls to the accuracy line', () => {
    const m = new PitchMeter();
    expect(m.click(0)).toBe('rising');
    const tFull = 1 / RISE_RATE;
    expect(m.value(tFull)).toBeCloseTo(1, 5);
    expect(m.click(tFull)).toBe('falling');
    expect(m.power).toBeCloseTo(1, 5);
    // Find when it reaches the line and click exactly there.
    const tLine = tFull + 1 / 1.5;
    expect(m.value(tLine)).toBeCloseTo(0, 5);
    expect(m.click(tLine)).toBe('done');
    expect(m.result!.power).toBeCloseTo(1, 5);
    expect(m.result!.accuracy).toBeCloseTo(0, 5);
  });

  it('early clicks are positive, late clicks negative', () => {
    const early = new PitchMeter();
    early.click(0);
    early.click(0.5);
    early.click(0.6);
    expect(early.result!.accuracy).toBeGreaterThan(0);

    const late = new PitchMeter();
    late.click(0);
    late.click(0.5);
    late.click(0.5 + 0.7);
    expect(late.result!.accuracy).toBeLessThan(0);
  });

  it('tops out at max power and auto-finishes when it falls too far', () => {
    const m = new PitchMeter();
    m.click(0);
    m.update(5);
    expect(m.phase).toBe('falling');
    expect(m.power).toBeCloseTo(MAX_POWER, 5);
    m.update(50);
    expect(m.phase).toBe('done');
    expect(m.result!.accuracy).toBeCloseTo(LATE_LIMIT, 5);
  });

  it('miss distance grows with accuracy error, effort and bad control', () => {
    const perfect = missInches({ power: 1, accuracy: 0 }, 80);
    const off = missInches({ power: 1, accuracy: 0.1 }, 80);
    const effort = missInches({ power: 1.1, accuracy: 0.1 }, 80);
    const wild = missInches({ power: 1, accuracy: 0.1 }, 20);
    expect(perfect).toBeLessThan(1.5);
    expect(off).toBeGreaterThan(perfect);
    expect(effort).toBeGreaterThan(off);
    expect(wild).toBeGreaterThan(off);
    expect(effortBonusMph(1.1)).toBeGreaterThan(1);
    expect(effortBonusMph(0.9)).toBe(0);
  });
});
