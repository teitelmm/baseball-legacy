export type Handedness = 'R' | 'L';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Location on the zone plane (feet): x across the plate, y height. */
export interface PlateLoc {
  x: number;
  y: number;
}

export type PitchTypeId = 'FF' | 'SI' | 'SL' | 'CU' | 'CH';

/** All ratings are 0-100. Stage 3's player creator fills these in. */
export interface BattingRatings {
  contact: number;
  power: number;
  eye: number;
}

export interface PitchingRatings {
  velocity: number;
  control: number;
  movement: number;
}

export interface Batter {
  name: string;
  bats: Handedness;
  ratings: BattingRatings;
}

export interface Pitcher {
  name: string;
  throws: Handedness;
  ratings: PitchingRatings;
  repertoire: PitchTypeId[];
}

export interface Count {
  balls: number;
  strikes: number;
}

/** [first, second, third] occupied. */
export type Bases = [boolean, boolean, boolean];

export type SwingType = 'normal' | 'power';
