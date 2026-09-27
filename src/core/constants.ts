// World units are feet. +y is up, home plate is at the origin, the pitcher is
// toward -z (center field), and +x is the first-base side.

export const MPH_TO_FPS = 5280 / 3600;
export const FPS_TO_MPH = 1 / MPH_TO_FPS;
export const GRAVITY = 32.174; // ft/s^2
export const INCH = 1 / 12;

export const BALL_RADIUS = 1.45 * INCH;

// The zone plane is the front edge of home plate (z = 0). The plate extends
// back toward the catcher (+z).
export const ZONE_Z = 0;
export const PLATE_HALF_WIDTH = 8.5 * INCH;
export const PLATE_DEPTH = 17 * INCH;
export const ZONE_BOTTOM = 1.6;
export const ZONE_TOP = 3.45;
export const ZONE_CENTER_Y = (ZONE_BOTTOM + ZONE_TOP) / 2;

export const RUBBER_Z = -(60.5 - PLATE_DEPTH);
export const MOUND_HEIGHT = 10 * INCH;
export const RELEASE_EXTENSION = 6.3;
export const RELEASE_Z = RUBBER_Z + RELEASE_EXTENSION;
export const RELEASE_HEIGHT = 5.9;
export const RELEASE_SIDE = 1.9; // ft toward the pitcher's arm side
export const CATCHER_Z = 2.6;

export const BASE_DISTANCE = 90;

/** Fence distance (ft) by spray angle in degrees (0 = straightaway center, ±45 = foul lines). */
export const FENCE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0, 400],
  [22.5, 375],
  [45, 330],
];
export const WALL_HEIGHT = 10;
export const FOUL_ANGLE = 45;

export function fenceDistance(sprayDeg: number): number {
  const a = Math.min(Math.abs(sprayDeg), FOUL_ANGLE);
  for (let i = 0; i < FENCE_POINTS.length - 1; i++) {
    const [a0, d0] = FENCE_POINTS[i];
    const [a1, d1] = FENCE_POINTS[i + 1];
    if (a <= a1) {
      const t = (a - a0) / (a1 - a0);
      // Smooth (cosine) blend so the wall curves instead of kinking.
      const s = (1 - Math.cos(t * Math.PI)) / 2;
      return d0 + (d1 - d0) * s;
    }
  }
  return FENCE_POINTS[FENCE_POINTS.length - 1][1];
}

/** How long after the click the bat reaches the hitting zone. */
export const SWING_TIME_MS = 150;

export type DifficultyName = 'rookie' | 'pro' | 'allstar' | 'legend';

export interface Difficulty {
  name: DifficultyName;
  label: string;
  /** Multiplies the human batter's timing windows. */
  timingScale: number;
  /** Multiplies the human batter's PCI size. */
  pciScale: number;
  /** Rating the CPU opponent plays at (0-100). */
  cpuRating: number;
  /** Multiplies the human pitcher's meter speed. */
  meterSpeed: number;
  /** Multiplies the human pitcher's miss distance. */
  pitchErrorScale: number;
}

export const DIFFICULTIES: Record<DifficultyName, Difficulty> = {
  rookie: { name: 'rookie', label: 'Rookie', timingScale: 1.6, pciScale: 1.3, cpuRating: 40, meterSpeed: 0.8, pitchErrorScale: 0.7 },
  pro: { name: 'pro', label: 'Pro', timingScale: 1.3, pciScale: 1.15, cpuRating: 58, meterSpeed: 0.95, pitchErrorScale: 0.9 },
  allstar: { name: 'allstar', label: 'All-Star', timingScale: 1.0, pciScale: 1.0, cpuRating: 75, meterSpeed: 1.1, pitchErrorScale: 1.0 },
  legend: { name: 'legend', label: 'Legend', timingScale: 0.8, pciScale: 0.85, cpuRating: 90, meterSpeed: 1.25, pitchErrorScale: 1.15 },
};
