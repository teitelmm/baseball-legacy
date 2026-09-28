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

/** How long the swing animation takes to bring the bat to the hitting zone. */
export const SWING_TIME_MS = 90;

/**
 * When a human batter's click is "perfect": this long after the ball reaches the plate.
 * People click when they *see* the ball arrive, and the screen shows it a frame or two
 * late, so the ideal click sits just after the real arrival (the swing animation is
 * started early to match, so the bat still meets the ball).
 */
export const USER_SWING_LAG_MS = 25;

export type DifficultyName = 'rookie' | 'pro' | 'allstar' | 'legend';

export interface Difficulty {
  name: DifficultyName;
  label: string;
  /** Multiplies the human batter's timing windows. */
  timingScale: number;
  /** Multiplies the human batter's PCI size. */
  pciScale: number;
  /** Fraction (0-1) the PCI is pulled toward the ball when a swing is judged. */
  contactAssist: number;
  /** Show where the pitch will cross the plate once it's released. */
  pitchGuide: boolean;
  /** Opacity (0-1) of the ball tracker: the ball's current height and side shown on the zone. */
  ballTracker: number;
  /** How much of the comet tail behind a pitch is drawn (0-1). */
  pitchTail: number;
  /** Rating the CPU opponent plays at (0-100). */
  cpuRating: number;
  /** Velocity/movement rating of the CPU pitcher you bat against. */
  cpuPitcherStuff: number;
  /** Added to the CPU pitcher's chance of throwing in the zone. */
  cpuZoneBias: number;
  /** Multiplies the human pitcher's meter speed. */
  meterSpeed: number;
  /** Multiplies the human pitcher's miss distance. */
  pitchErrorScale: number;
}

export const DIFFICULTIES: Record<DifficultyName, Difficulty> = {
  rookie: {
    name: 'rookie',
    label: 'Rookie',
    timingScale: 2.4,
    pciScale: 1.7,
    contactAssist: 0.5,
    pitchGuide: true,
    ballTracker: 1,
    pitchTail: 1,
    cpuRating: 40,
    cpuPitcherStuff: 20,
    cpuZoneBias: 0.2,
    meterSpeed: 0.8,
    pitchErrorScale: 0.7,
  },
  pro: {
    name: 'pro',
    label: 'Pro',
    timingScale: 1.7,
    pciScale: 1.45,
    contactAssist: 0.35,
    pitchGuide: false,
    ballTracker: 0.85,
    pitchTail: 1,
    cpuRating: 58,
    cpuPitcherStuff: 45,
    cpuZoneBias: 0.08,
    meterSpeed: 0.95,
    pitchErrorScale: 0.9,
  },
  allstar: {
    name: 'allstar',
    label: 'All-Star',
    timingScale: 1.2,
    pciScale: 1.15,
    contactAssist: 0.15,
    pitchGuide: false,
    ballTracker: 0.5,
    pitchTail: 0.75,
    cpuRating: 75,
    cpuPitcherStuff: 75,
    cpuZoneBias: 0,
    meterSpeed: 1.1,
    pitchErrorScale: 1.0,
  },
  legend: {
    name: 'legend',
    label: 'Legend',
    timingScale: 0.95,
    pciScale: 0.95,
    contactAssist: 0.05,
    pitchGuide: false,
    ballTracker: 0,
    pitchTail: 0.5,
    cpuRating: 90,
    cpuPitcherStuff: 92,
    cpuZoneBias: 0,
    meterSpeed: 1.25,
    pitchErrorScale: 1.15,
  },
};
