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

export type Position = 'P' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH';
export type FieldPosition = Exclude<Position, 'DH'>;

export const FIELD_POSITIONS: FieldPosition[] = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

/** Scorekeeping numbers (P=1 ... RF=9). */
export const POSITION_NUMBER: Record<FieldPosition, number> = {
  P: 1,
  C: 2,
  '1B': 3,
  '2B': 4,
  '3B': 5,
  SS: 6,
  LF: 7,
  CF: 8,
  RF: 9,
};

export interface FieldingRatings {
  /** Running speed. */
  speed: number;
  /** Throwing strength. */
  arm: number;
  /** Reaction and range. */
  glove: number;
}

export interface Player {
  id: string;
  name: string;
  number: number;
  bats: Handedness;
  throws: Handedness;
  pos: Position;
  batting: BattingRatings;
  fielding: FieldingRatings;
  pitching?: PitchingRatings & { stamina: number };
  repertoire?: PitchTypeId[];
  isUser?: boolean;
}

export interface TeamColors {
  jersey: string;
  pants: string;
  cap: string;
  accent: string;
  /** Pinstriped uniform. */
  pinstripes?: boolean;
  /** Letter(s) on the cap. */
  logo?: string;
}

export interface Team {
  id: string;
  name: string;
  abbr: string;
  colors: TeamColors;
  players: Record<string, Player>;
  /** Batting order: 9 player ids. */
  lineup: string[];
  /** Who plays each field position (the pitcher slot is filled by the current pitcher). */
  defense: Record<Exclude<FieldPosition, 'P'>, string>;
  /** Starting pitcher first, then the bullpen in the order they're used. */
  pitchers: string[];
  /** Five-man rotation and bullpen (seasons pick today's starter from the rotation). */
  rotation?: string[];
  bullpen?: string[];
  /** Players who sit today (e.g. the regular DH on a two-way pitching day). */
  bench?: string[];
}
