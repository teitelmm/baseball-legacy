import type { PitchTypeId } from '../core/types';

export interface PitchTypeDef {
  id: PitchTypeId;
  name: string;
  /** Speed relative to the pitcher's max velocity. */
  speedFactor: number;
  /** Horizontal break in inches toward the pitcher's arm side (negative = glove side). */
  horizontalBreak: number;
  /** Induced vertical break in inches (movement vs. a spinless ball; gravity is added separately). */
  inducedVerticalBreak: number;
  /** True for pitches hitters have a harder time reading. */
  breaking: boolean;
  color: string;
}

export const PITCH_TYPES: Record<PitchTypeId, PitchTypeDef> = {
  FF: { id: 'FF', name: 'Four-Seam', speedFactor: 1.0, horizontalBreak: 7, inducedVerticalBreak: 16, breaking: false, color: '#ff5a4f' },
  SI: { id: 'SI', name: 'Sinker', speedFactor: 0.97, horizontalBreak: 15, inducedVerticalBreak: 7, breaking: false, color: '#ffa53d' },
  SL: { id: 'SL', name: 'Slider', speedFactor: 0.88, horizontalBreak: -7, inducedVerticalBreak: 2, breaking: true, color: '#f7e14b' },
  CU: { id: 'CU', name: 'Curveball', speedFactor: 0.81, horizontalBreak: -8, inducedVerticalBreak: -11, breaking: true, color: '#4fc3ff' },
  CH: { id: 'CH', name: 'Changeup', speedFactor: 0.86, horizontalBreak: 14, inducedVerticalBreak: 6, breaking: true, color: '#7ee07e' },
};

export const PITCH_ORDER: PitchTypeId[] = ['FF', 'SI', 'SL', 'CU', 'CH'];

/** Max fastball velocity (mph) for a velocity rating 0-100. */
export function maxVelocity(velocityRating: number): number {
  return 86 + (velocityRating / 100) * 15;
}

/** Movement multiplier for a movement rating 0-100. */
export function movementScale(movementRating: number): number {
  return 0.75 + (movementRating / 100) * 0.45;
}
