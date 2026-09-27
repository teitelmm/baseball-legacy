import { describe, expect, it } from 'vitest';
import { INCH, ZONE_Z } from '../src/core/constants';
import type { Handedness } from '../src/core/types';
import { buildPitch, positionAt, timeAtZ } from '../src/sim/pitchPhysics';
import { PITCH_ORDER, PITCH_TYPES } from '../src/sim/pitchTypes';

describe('pitch physics', () => {
  for (const throws of ['R', 'L'] as Handedness[]) {
    for (const type of PITCH_ORDER) {
      it(`${throws}HP ${type} crosses the plate at its target`, () => {
        const target = { x: 0.3, y: 2.2 };
        const p = buildPitch({ type, throws, speedMph: 90, plateLoc: target });
        const at = positionAt(p, p.flightTime);
        expect(Math.abs(at.x - target.x)).toBeLessThan(0.5 * INCH);
        expect(Math.abs(at.y - target.y)).toBeLessThan(0.5 * INCH);
        expect(Math.abs(at.z - ZONE_Z)).toBeLessThan(0.01);
        expect(timeAtZ(p, ZONE_Z)).toBeCloseTo(p.flightTime, 5);
      });
    }
  }

  it('a 95 mph fastball takes about 0.4 s and loses speed', () => {
    const p = buildPitch({ type: 'FF', throws: 'R', speedMph: 95, plateLoc: { x: 0, y: 2.5 } });
    expect(p.flightTime).toBeGreaterThan(0.36);
    expect(p.flightTime).toBeLessThan(0.44);
    expect(p.plateSpeedMph).toBeLessThan(95);
    expect(p.plateSpeedMph).toBeGreaterThan(84);
  });

  it('left-handed pitches break the mirror-image way', () => {
    for (const type of PITCH_ORDER) {
      const r = buildPitch({ type, throws: 'R', speedMph: 88, plateLoc: { x: 0, y: 2.5 } });
      const l = buildPitch({ type, throws: 'L', speedMph: 88, plateLoc: { x: 0, y: 2.5 } });
      expect(l.a.x).toBeCloseTo(-r.a.x, 6);
      expect(l.a.y).toBeCloseTo(r.a.y, 6);
      expect(l.p0.x).toBeCloseTo(-r.p0.x, 6);
    }
  });

  it("a righty's slider breaks toward first base and his sinker toward third", () => {
    const sl = buildPitch({ type: 'SL', throws: 'R', speedMph: 86, plateLoc: { x: 0, y: 2.5 } });
    const si = buildPitch({ type: 'SI', throws: 'R', speedMph: 93, plateLoc: { x: 0, y: 2.5 } });
    expect(sl.a.x).toBeGreaterThan(0);
    expect(si.a.x).toBeLessThan(0);
  });

  it('a curveball drops more than a four-seamer', () => {
    const cu = buildPitch({ type: 'CU', throws: 'R', speedMph: 80, plateLoc: { x: 0, y: 2.5 } });
    const ff = buildPitch({ type: 'FF', throws: 'R', speedMph: 95, plateLoc: { x: 0, y: 2.5 } });
    expect(cu.a.y).toBeLessThan(ff.a.y);
    expect(PITCH_TYPES.CU.inducedVerticalBreak).toBeLessThan(0);
  });
});
