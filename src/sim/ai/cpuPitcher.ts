import { INCH, PLATE_HALF_WIDTH, ZONE_BOTTOM, ZONE_TOP } from '../../core/constants';
import type { Rng } from '../../core/rng';
import type { Count, Handedness, Pitcher, PitchTypeId, PlateLoc } from '../../core/types';
import { maxVelocity, movementScale, PITCH_TYPES } from '../pitchTypes';
import type { PitchSpec } from '../pitchPhysics';

export interface CpuPitchPlan {
  spec: PitchSpec;
  target: PlateLoc;
}

/** Chance the CPU pitcher attacks the zone for a given count. */
export function zoneRate(count: Count): number {
  const { balls, strikes } = count;
  if (balls === 3) return 0.68;
  if (strikes === 2 && balls < 2) return 0.22;
  if (strikes > balls) return 0.32;
  if (balls > strikes) return 0.52;
  return 0.43;
}

function choosePitch(p: Pitcher, count: Count, rng: Rng): PitchTypeId {
  const behind = count.balls > count.strikes;
  const weights = p.repertoire.map((id) => {
    const fastball = id === 'FF' || id === 'SI';
    let w = fastball ? 1.4 : 1;
    if (behind && fastball) w *= 1.8;
    if (count.strikes === 2 && !fastball) w *= 1.6;
    return [id, w] as const;
  });
  return rng.weighted(weights);
}

function chooseTarget(type: PitchTypeId, inZone: boolean, batterHand: Handedness, rng: Rng): PlateLoc {
  const halfW = PLATE_HALF_WIDTH;
  if (inZone) {
    // Favor the edges of the zone.
    const col = rng.weighted([[-1, 1.2], [0, 0.7], [1, 1.2]] as const);
    const row = rng.weighted([[-1, 1.2], [0, 0.8], [1, 1.0]] as const);
    return {
      x: col * halfW * 0.65 + rng.gaussian(0, 1.2 * INCH),
      y: (ZONE_BOTTOM + ZONE_TOP) / 2 + row * (ZONE_TOP - ZONE_BOTTOM) * 0.33 + rng.gaussian(0, 1 * INCH),
    };
  }
  // Chase pitches: breaking balls below the zone, fastballs up, or off the edges.
  const away = batterHand === 'R' ? 1 : -1;
  const def = PITCH_TYPES[type];
  if (def.breaking && rng.chance(0.7)) {
    return { x: rng.gaussian(away * 3 * INCH, 4 * INCH), y: ZONE_BOTTOM - 4 * INCH + rng.gaussian(0, 1.5 * INCH) };
  }
  if (type === 'FF' && rng.chance(0.5)) {
    return { x: rng.gaussian(0, 4 * INCH), y: ZONE_TOP + 3.5 * INCH + rng.gaussian(0, 1.5 * INCH) };
  }
  const side = rng.chance(0.65) ? away : -away;
  return { x: side * (halfW + 4 * INCH), y: rng.range(ZONE_BOTTOM + 3 * INCH, ZONE_TOP - 3 * INCH) };
}

/** Standard deviation of the CPU's miss, inches, for a control rating. */
export function cpuMissStd(control: number): number {
  return 1.2 + (100 - control) * 0.055;
}

export function planCpuPitch(p: Pitcher, count: Count, batterHand: Handedness, rng: Rng, zoneBias = 0): CpuPitchPlan {
  const type = choosePitch(p, count, rng);
  const inZone = rng.chance(Math.min(0.95, zoneRate(count) + zoneBias));
  const target = chooseTarget(type, inZone, batterHand, rng);
  const std = cpuMissStd(p.ratings.control) * INCH;
  const plateLoc = { x: target.x + rng.gaussian(0, std), y: target.y + rng.gaussian(0, std) };
  const def = PITCH_TYPES[type];
  const speedMph = maxVelocity(p.ratings.velocity) * def.speedFactor * rng.range(0.975, 1.0);
  return {
    target,
    spec: {
      type,
      throws: p.throws,
      speedMph,
      plateLoc,
      breakScale: movementScale(p.ratings.movement),
    },
  };
}
