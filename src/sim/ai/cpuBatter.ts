import { INCH } from '../../core/constants';
import type { Rng } from '../../core/rng';
import type { Batter, Count, PlateLoc, SwingType } from '../../core/types';
import type { PitchTrajectory } from '../pitchPhysics';
import { PITCH_TYPES } from '../pitchTypes';
import type { SwingInput } from '../swing';
import { distanceOutsideZone } from '../zone';

export interface CpuSwingDecision {
  swing: boolean;
  input?: SwingInput;
  /** Where the batter thought the pitch was going. */
  perceived: PlateLoc;
}

/**
 * Decide whether the CPU batter swings and, if so, where and when.
 * The result is fed to the same evaluateSwing() the human batter uses.
 */
export function decideCpuSwing(
  batter: Batter,
  pitch: PitchTrajectory,
  count: Count,
  prevPitchSpeedMph: number | null,
  rng: Rng,
): CpuSwingDecision {
  const def = PITCH_TYPES[pitch.spec.type];
  const actual = pitch.spec.plateLoc;
  const { eye, contact, power } = batter.ratings;

  // Recognition: noisy read of where the pitch ends up.
  const outside = distanceOutsideZone(actual) > 0;
  const readStd = (1.5 + (100 - eye) * 0.06) * (def.breaking ? 1.6 : 1) * (outside ? 1.3 : 1) * INCH;
  const perceived = { x: actual.x + rng.gaussian(0, readStd), y: actual.y + rng.gaussian(0, readStd) };

  // Protect with two strikes; take on 3-0.
  // Real hitters swing at ~65% of strikes and chase ~28% of balls, mostly the close ones.
  const outBy = distanceOutsideZone(perceived);
  const discipline = 1.05 - eye / 100; // 0.05 (elite eye) .. 1.05
  let swingChance: number;
  if (outBy <= 0) {
    swingChance = count.balls === 3 && count.strikes === 0 ? 0.2 : count.strikes === 2 ? 0.86 : count.balls === 0 && count.strikes === 0 ? 0.55 : 0.7;
  } else {
    const closeness = Math.exp(-outBy / (3 * INCH));
    swingChance = (count.strikes === 2 ? 0.55 : 0.4) * closeness * discipline + 0.03;
    if (count.balls === 3 && count.strikes < 2) swingChance *= 0.5;
  }
  if (!rng.chance(swingChance)) return { swing: false, perceived };

  // Timing: sitting on the previous speed makes changes of speed hard.
  const speedDiff = prevPitchSpeedMph === null ? 0 : prevPitchSpeedMph - pitch.spec.speedMph;
  const bias = -speedDiff * 1.3 + rng.gaussian(0, 4);
  const timingStd = 16 + (100 - contact) * 0.35 + (def.breaking ? 6 : 0);
  const timingErrorMs = rng.gaussian(bias, timingStd);

  // Aim at the perceived location with some error.
  // Aim: batters track the ball late, so most of the early misread is corrected.
  const aimStd = (1.2 + (100 - contact) * 0.035) * (def.breaking ? 1.25 : 1) * INCH;
  const pci = {
    x: actual.x + (perceived.x - actual.x) * 0.5 + rng.gaussian(0, aimStd),
    y: actual.y + (perceived.y - actual.y) * 0.5 + rng.gaussian(0, aimStd),
  };

  const hitterCount = count.balls >= 2 && count.balls > count.strikes;
  const type: SwingType = hitterCount && power > 60 && rng.chance(0.35) ? 'power' : 'normal';

  return { swing: true, perceived, input: { type, pci, timingErrorMs } };
}
