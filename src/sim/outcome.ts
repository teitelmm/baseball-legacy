import { FOUL_ANGLE } from '../core/constants';
import type { Rng } from '../core/rng';
import type { BattedBallPath } from './battedBall';
import { sprayOf } from './battedBall';

export type HitResult = 'single' | 'double' | 'triple' | 'homeRun';
export type OutType = 'groundout' | 'lineout' | 'flyout' | 'popout';
export type BattedBallType = 'ground ball' | 'line drive' | 'fly ball' | 'pop up';

export type BallInPlayOutcome =
  | { kind: 'foul'; label: string }
  | { kind: 'hit'; hit: HitResult; label: string; battedBallType: BattedBallType }
  | { kind: 'out'; out: OutType; label: string; battedBallType: BattedBallType; sacFlyDepth: boolean };

export function battedBallType(launchAngleDeg: number): BattedBallType {
  if (launchAngleDeg < 10) return 'ground ball';
  if (launchAngleDeg < 25) return 'line drive';
  if (launchAngleDeg < 50) return 'fly ball';
  return 'pop up';
}

const HIT_LABEL: Record<HitResult, string> = {
  single: 'Single',
  double: 'Double',
  triple: 'Triple',
  homeRun: 'HOME RUN!',
};

const OUT_LABEL: Record<OutType, string> = {
  groundout: 'Ground out',
  lineout: 'Line out',
  flyout: 'Fly out',
  popout: 'Pop out',
};

function hit(h: HitResult, t: BattedBallType): BallInPlayOutcome {
  return { kind: 'hit', hit: h, label: HIT_LABEL[h], battedBallType: t };
}

function out(o: OutType, t: BattedBallType, sacFlyDepth = false): BallInPlayOutcome {
  return { kind: 'out', out: o, label: OUT_LABEL[o], battedBallType: t, sacFlyDepth };
}

/**
 * Stage 1 stand-in for fielding: decide the result of a ball in play from its
 * flight and simple hit-probability odds. Stage 2 replaces this with real fielders.
 */
export function classifyBattedBall(path: BattedBallPath, rng: Rng): BallInPlayOutcome {
  const { exitVeloMph: ev, launchAngleDeg: la } = path.init;
  const t = battedBallType(la);

  // Fair/foul: where it lands (or, for grounders, the initial direction past the bag).
  const spray = t === 'ground ball' ? path.init.sprayDeg : sprayOf(path.landing);
  if (Math.abs(spray) > FOUL_ANGLE || path.distance < 3) {
    return { kind: 'foul', label: 'Foul ball' };
  }

  if (path.homeRun) return hit('homeRun', t);

  const d = path.distance;
  const alongLine = Math.abs(spray) > 32;

  switch (t) {
    case 'ground ball': {
      const p = ev < 70 ? 0.12 : ev < 90 ? 0.22 : ev < 100 ? 0.38 : 0.52;
      if (!rng.chance(p)) return out('groundout', t);
      return hit(ev > 98 && alongLine && rng.chance(0.35) ? 'double' : 'single', t);
    }
    case 'line drive': {
      const p = ev < 75 ? 0.5 : ev < 90 ? 0.63 : 0.74;
      if (!rng.chance(p)) return out('lineout', t, d > 240);
      if (path.hitWall || d > 300) return hit(rng.chance(0.12) ? 'triple' : 'double', t);
      if (d > 230) return hit(rng.chance(0.45) ? 'double' : 'single', t);
      return hit('single', t);
    }
    case 'fly ball': {
      if (path.hitWall) return hit(rng.chance(0.2) ? 'triple' : 'double', t);
      if (d < 160) return rng.chance(0.35) ? hit('single', t) : out('flyout', t);
      if (d < 290) return rng.chance(0.06) ? hit('single', t) : out('flyout', t, d > 240);
      if (d < 340) return rng.chance(0.14) ? hit('double', t) : out('flyout', t, true);
      return rng.chance(0.45) ? hit(rng.chance(0.25) ? 'triple' : 'double', t) : out('flyout', t, true);
    }
    case 'pop up':
      return rng.chance(0.02) ? hit('single', t) : out('popout', t);
  }
}
