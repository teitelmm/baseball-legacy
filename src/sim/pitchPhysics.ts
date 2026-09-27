import {
  GRAVITY,
  INCH,
  MPH_TO_FPS,
  RELEASE_HEIGHT,
  RELEASE_SIDE,
  RELEASE_Z,
  ZONE_Z,
} from '../core/constants';
import type { Handedness, PitchTypeId, PlateLoc, Vec3 } from '../core/types';
import { PITCH_TYPES } from './pitchTypes';

/** Fraction of release speed lost to drag by the time the ball reaches the plate. */
export const SPEED_LOSS = 0.08;

export interface PitchSpec {
  type: PitchTypeId;
  throws: Handedness;
  /** Release speed in mph. */
  speedMph: number;
  /** Where the ball actually crosses the zone plane (target plus any miss). */
  plateLoc: PlateLoc;
  /** Multiplier on the pitch type's break (movement rating, effort). */
  breakScale?: number;
}

/**
 * A pitch under constant acceleration (gravity + spin break + drag along z).
 * Solving backwards from the plate location keeps it exact and deterministic.
 */
export interface PitchTrajectory {
  spec: PitchSpec;
  p0: Vec3;
  v0: Vec3;
  a: Vec3;
  /** Seconds from release to the zone plane. */
  flightTime: number;
  /** Speed crossing the plate, mph. */
  plateSpeedMph: number;
}

export function releasePoint(throws: Handedness): Vec3 {
  // A right-hander's arm side is the third-base side (-x).
  const armSide = throws === 'R' ? -1 : 1;
  return { x: armSide * RELEASE_SIDE, y: RELEASE_HEIGHT, z: RELEASE_Z };
}

export function buildPitch(spec: PitchSpec): PitchTrajectory {
  const def = PITCH_TYPES[spec.type];
  const p0 = releasePoint(spec.throws);
  const v = spec.speedMph * MPH_TO_FPS;
  const distance = ZONE_Z - p0.z;
  // With a constant deceleration that loses SPEED_LOSS of the speed, the average
  // speed is (1 - SPEED_LOSS / 2) * v.
  const t = distance / ((1 - SPEED_LOSS / 2) * v);

  const scale = spec.breakScale ?? 1;
  const armSide = spec.throws === 'R' ? -1 : 1;
  const hb = def.horizontalBreak * INCH * scale;
  const ivb = def.inducedVerticalBreak * INCH * scale;
  const a: Vec3 = {
    x: (armSide * 2 * hb) / (t * t),
    y: -GRAVITY + (2 * ivb) / (t * t),
    z: -(SPEED_LOSS * v) / t, // drag slows the ball as it travels toward the plate (+z)
  };

  const target: Vec3 = { x: spec.plateLoc.x, y: spec.plateLoc.y, z: ZONE_Z };
  const v0: Vec3 = {
    x: (target.x - p0.x - 0.5 * a.x * t * t) / t,
    y: (target.y - p0.y - 0.5 * a.y * t * t) / t,
    z: (target.z - p0.z - 0.5 * a.z * t * t) / t,
  };

  const vPlate = {
    x: v0.x + a.x * t,
    y: v0.y + a.y * t,
    z: v0.z + a.z * t,
  };
  const plateSpeed = Math.hypot(vPlate.x, vPlate.y, vPlate.z);

  return { spec, p0, v0, a, flightTime: t, plateSpeedMph: plateSpeed / MPH_TO_FPS };
}

export function positionAt(p: PitchTrajectory, t: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  out.x = p.p0.x + p.v0.x * t + 0.5 * p.a.x * t * t;
  out.y = p.p0.y + p.v0.y * t + 0.5 * p.a.y * t * t;
  out.z = p.p0.z + p.v0.z * t + 0.5 * p.a.z * t * t;
  return out;
}

export function velocityAt(p: PitchTrajectory, t: number): Vec3 {
  return { x: p.v0.x + p.a.x * t, y: p.v0.y + p.a.y * t, z: p.v0.z + p.a.z * t };
}

/** Time (s) at which the pitch reaches depth z (e.g. the catcher). */
export function timeAtZ(p: PitchTrajectory, z: number): number {
  // Solve 0.5 a t^2 + v0 t + (p0 - z) = 0 for the first positive root.
  const A = 0.5 * p.a.z;
  const B = p.v0.z;
  const C = p.p0.z - z;
  if (Math.abs(A) < 1e-9) return -C / B;
  const disc = B * B - 4 * A * C;
  const r = Math.sqrt(Math.max(0, disc));
  const t1 = (-B - r) / (2 * A);
  const t2 = (-B + r) / (2 * A);
  const roots = [t1, t2].filter((t) => t >= 0).sort((m, n) => m - n);
  return roots[0] ?? p.flightTime;
}
