import type { BattingRatings, PitchingRatings } from './types';

/** Live-tweakable settings (debug panel). */
export const tuning = {
  showZone: true,
  showTrail: false,
  showTimingMs: true,
  timeScale: 1,
  /** 0 = use the difficulty preset. */
  timingScaleOverride: 0,
  pciScaleOverride: 0,
  cpuRatingOverride: 0,
  userBatter: { contact: 70, power: 70, eye: 70 } as BattingRatings,
  userPitcher: { velocity: 70, control: 70, movement: 70 } as PitchingRatings,
};
