import { FOUL_ANGLE } from '../core/constants';
import type { BattedBallPath } from './battedBall';
import { sprayOf } from './battedBall';

export type BattedBallType = 'ground ball' | 'line drive' | 'fly ball' | 'pop up';

export function battedBallType(launchAngleDeg: number): BattedBallType {
  if (launchAngleDeg < 10) return 'ground ball';
  if (launchAngleDeg < 25) return 'line drive';
  if (launchAngleDeg < 50) return 'fly ball';
  return 'pop up';
}

/**
 * Fair or foul: grounders by the direction they leave the bat (past the bag),
 * everything else by where it first lands. Home runs are always fair.
 */
export function isFoul(path: BattedBallPath): boolean {
  if (path.homeRun) return false;
  const t = battedBallType(path.init.launchAngleDeg);
  const spray = t === 'ground ball' ? path.init.sprayDeg : sprayOf(path.landing);
  return Math.abs(spray) > FOUL_ANGLE || path.distance < 3;
}
