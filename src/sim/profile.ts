import type { BattingRatings, FieldingRatings, Handedness, PitchingRatings } from '../core/types';
import type { UserRole } from './team';

export type HitArchetype = 'contact' | 'power' | 'fiveTool' | 'speed' | 'balanced';
export type PitchArchetype = 'flamethrower' | 'control' | 'junk' | 'workhorse';
export type HairStyle = 'none' | 'buzz' | 'short' | 'long' | 'curly';
export type FacialHair = 'none' | 'stubble' | 'mustache' | 'goatee' | 'beard';
export type Build = 'slim' | 'athletic' | 'stocky';

export type HitKey = 'contact' | 'power' | 'eye' | 'speed' | 'arm' | 'glove';
export type PitchKey = 'velocity' | 'control' | 'movement' | 'stamina';
export type RatingKey = HitKey | PitchKey;

export interface AppearanceSpec {
  skin: string;
  hair: HairStyle;
  hairColor: string;
  facialHair: FacialHair;
  build: Build;
  /** Height in inches (68 = 5'8" .. 78 = 6'6"). */
  heightIn: number;
  eyeBlack: boolean;
  batColor: string;
  gloveColor: string;
}

export interface PlayerProfile {
  version: 1;
  id: string;
  firstName: string;
  lastName: string;
  number: number;
  primary: UserRole;
  /** Two-way players: the second role. One of the pair is always P. */
  secondary: UserRole | null;
  bats: Handedness;
  throws: Handedness;
  hitArchetype: HitArchetype | null;
  pitchArchetype: PitchArchetype | null;
  /** Bonus points added to each rating. */
  bonus: Partial<Record<RatingKey, number>>;
  appearance: AppearanceSpec;
  createdAt: number;
  /** Rating gains earned during seasons. */
  progress?: Partial<Record<RatingKey, number>>;
  /** Unspent skill points. */
  skillPoints?: number;
}

export interface ArchetypeDef<K extends string> {
  name: string;
  blurb: string;
  ratings: Record<K, number>;
}

export const HIT_ARCHETYPES: Record<HitArchetype, ArchetypeDef<HitKey>> = {
  contact: {
    name: 'Contact Hitter',
    blurb: 'Puts the bat on everything. Big PCI, good eye, modest pop.',
    ratings: { contact: 76, power: 56, eye: 72, speed: 62, arm: 58, glove: 64 },
  },
  power: {
    name: 'Power Slugger',
    blurb: 'Hits it a mile on contact. Swings and misses more.',
    ratings: { contact: 58, power: 78, eye: 62, speed: 50, arm: 66, glove: 56 },
  },
  fiveTool: {
    name: 'Five-Tool',
    blurb: 'A little of everything, no real weakness, no standout.',
    ratings: { contact: 66, power: 66, eye: 64, speed: 66, arm: 66, glove: 66 },
  },
  speed: {
    name: 'Speedster',
    blurb: 'Elite wheels and range in the outfield. Light bat.',
    ratings: { contact: 68, power: 50, eye: 64, speed: 78, arm: 58, glove: 72 },
  },
  balanced: {
    name: 'Gap Hitter',
    blurb: 'Line drives into the gaps, solid arm, above-average eye.',
    ratings: { contact: 70, power: 64, eye: 68, speed: 60, arm: 64, glove: 60 },
  },
};

export const PITCH_ARCHETYPES: Record<PitchArchetype, ArchetypeDef<PitchKey>> = {
  flamethrower: {
    name: 'Flamethrower',
    blurb: 'Big velocity and a lively fastball. Control comes and goes.',
    ratings: { velocity: 78, control: 56, movement: 64, stamina: 66 },
  },
  control: {
    name: 'Control Artist',
    blurb: 'Paints the corners and rarely walks anyone. Average heat.',
    ratings: { velocity: 60, control: 78, movement: 64, stamina: 70 },
  },
  junk: {
    name: 'Junkballer',
    blurb: 'Nasty movement on everything. Lives on the edges of the zone.',
    ratings: { velocity: 56, control: 66, movement: 78, stamina: 68 },
  },
  workhorse: {
    name: 'Workhorse',
    blurb: 'Goes deep into games. Steady velocity, control and movement.',
    ratings: { velocity: 64, control: 66, movement: 64, stamina: 80 },
  },
};

export const BONUS_POOL = 15;
export const BONUS_MAX = 8;
export const RATING_CAP = 85;
/** Two-way players pay for doing both. */
export const TWO_WAY_PENALTY = 4;

export const HIT_KEYS: HitKey[] = ['contact', 'power', 'eye', 'speed', 'arm', 'glove'];
export const PITCH_KEYS: PitchKey[] = ['velocity', 'control', 'movement', 'stamina'];

export const RATING_LABEL: Record<RatingKey, string> = {
  contact: 'Contact',
  power: 'Power',
  eye: 'Eye',
  speed: 'Speed',
  arm: 'Arm',
  glove: 'Glove',
  velocity: 'Velocity',
  control: 'Control',
  movement: 'Movement',
  stamina: 'Stamina',
};

export const HITTING_SPOTS: UserRole[] = ['LF', 'CF', 'RF', 'DH'];

export function isTwoWay(p: PlayerProfile): boolean {
  return p.secondary !== null;
}

export function isPitcher(p: PlayerProfile): boolean {
  return p.primary === 'P' || p.secondary === 'P';
}

export function isHitter(p: PlayerProfile): boolean {
  return p.primary !== 'P' || (p.secondary !== null && p.secondary !== 'P');
}

/** The hitting position (LF/CF/RF/DH), if any. */
export function hittingSpot(p: PlayerProfile): UserRole | null {
  if (p.primary !== 'P') return p.primary;
  return p.secondary && p.secondary !== 'P' ? p.secondary : null;
}

export function relevantKeys(p: PlayerProfile): RatingKey[] {
  return [...(isHitter(p) ? HIT_KEYS : []), ...(isPitcher(p) ? PITCH_KEYS : [])];
}

export function bonusSpent(p: PlayerProfile): number {
  return relevantKeys(p).reduce((a, k) => a + (p.bonus[k] ?? 0), 0);
}

export function bonusRemaining(p: PlayerProfile): number {
  return BONUS_POOL - bonusSpent(p);
}

function baseRating(p: PlayerProfile, k: RatingKey): number {
  const penalty = isTwoWay(p) ? TWO_WAY_PENALTY : 0;
  if ((HIT_KEYS as string[]).includes(k)) {
    if (!isHitter(p) || !p.hitArchetype) {
      // Pitchers still field their position a little and can swing (badly).
      const pitcherHitting: Record<HitKey, number> = { contact: 30, power: 25, eye: 25, speed: 48, arm: 64, glove: 55 };
      return pitcherHitting[k as HitKey];
    }
    return HIT_ARCHETYPES[p.hitArchetype].ratings[k as HitKey] - penalty;
  }
  if (!isPitcher(p) || !p.pitchArchetype) {
    const positionPitching: Record<PitchKey, number> = { velocity: 40, control: 35, movement: 35, stamina: 30 };
    return positionPitching[k as PitchKey];
  }
  return PITCH_ARCHETYPES[p.pitchArchetype].ratings[k as PitchKey] - penalty;
}

/** The most bonus that can go on one rating right now. */
export function bonusCap(p: PlayerProfile, k: RatingKey): number {
  if (!relevantKeys(p).includes(k)) return 0;
  const current = p.bonus[k] ?? 0;
  return Math.max(0, Math.min(BONUS_MAX, RATING_CAP - baseRating(p, k), current + bonusRemaining(p)));
}

/** Set a bonus, clamped to the per-rating max, the cap and the points left. Returns a new profile. */
export function setBonus(p: PlayerProfile, k: RatingKey, value: number): PlayerProfile {
  const v = Math.max(0, Math.min(Math.round(value), bonusCap(p, k)));
  return { ...p, bonus: { ...p.bonus, [k]: v } };
}

export function rating(p: PlayerProfile, k: RatingKey): number {
  const bonus = relevantKeys(p).includes(k) ? p.bonus[k] ?? 0 : 0;
  const earned = p.progress?.[k] ?? 0;
  return Math.max(20, Math.min(99, baseRating(p, k) + bonus + earned));
}

/** Skill points to raise a rating by one. Higher ratings cost more. */
export function upgradeCost(current: number): number {
  return current < 65 ? 3 : current < 75 ? 4 : current < 85 ? 6 : 8;
}

/** Spend skill points on one rating. Returns the new profile, or null if you can't afford it. */
export function upgrade(p: PlayerProfile, k: RatingKey): PlayerProfile | null {
  const current = rating(p, k);
  const cost = upgradeCost(current);
  if (current >= 99 || (p.skillPoints ?? 0) < cost || !relevantKeys(p).includes(k)) return null;
  return { ...p, skillPoints: (p.skillPoints ?? 0) - cost, progress: { ...p.progress, [k]: (p.progress?.[k] ?? 0) + 1 } };
}

export interface FinalRatings {
  batting: BattingRatings;
  fielding: FieldingRatings;
  pitching: PitchingRatings & { stamina: number };
}

export function finalRatings(p: PlayerProfile): FinalRatings {
  const r = (k: RatingKey) => rating(p, k);
  return {
    batting: { contact: r('contact'), power: r('power'), eye: r('eye') },
    fielding: { speed: r('speed'), arm: r('arm'), glove: r('glove') },
    pitching: { velocity: r('velocity'), control: r('control'), movement: r('movement'), stamina: r('stamina') },
  };
}

/** One-number summary for the player card. */
export function overall(p: PlayerProfile): number {
  const r = (k: RatingKey) => rating(p, k);
  const hit = r('contact') * 0.28 + r('power') * 0.24 + r('eye') * 0.16 + r('speed') * 0.12 + r('arm') * 0.1 + r('glove') * 0.1;
  const pitch = r('velocity') * 0.3 + r('control') * 0.3 + r('movement') * 0.25 + r('stamina') * 0.15;
  if (isHitter(p) && isPitcher(p)) return Math.round(Math.max(hit, pitch) * 0.8 + Math.min(hit, pitch) * 0.35);
  return Math.round(isPitcher(p) ? pitch : hit);
}

export function displayName(p: PlayerProfile): string {
  return `${p.firstName.trim().charAt(0).toUpperCase()}. ${p.lastName.trim()}`;
}

export function positionLabel(p: PlayerProfile): string {
  return p.secondary ? `${p.primary}/${p.secondary}` : p.primary;
}

export function validate(p: PlayerProfile): string[] {
  const errors: string[] = [];
  if (!p.firstName.trim()) errors.push('Enter a first name.');
  if (!p.lastName.trim()) errors.push('Enter a last name.');
  if (!Number.isInteger(p.number) || p.number < 0 || p.number > 99) errors.push('Pick a number from 0 to 99.');
  if (p.secondary !== null) {
    const pair = [p.primary, p.secondary];
    if (!pair.includes('P') || pair[0] === pair[1]) errors.push('A two-way player pitches and plays one hitting spot (LF, CF, RF or DH).');
  }
  if (isHitter(p) && !p.hitArchetype) errors.push('Choose a hitting archetype.');
  if (isPitcher(p) && !p.pitchArchetype) errors.push('Choose a pitching archetype.');
  if (bonusRemaining(p) < 0) errors.push('You spent more bonus points than you have.');
  return errors;
}

export const SKIN_TONES = ['#f3cfb0', '#e0b48f', '#c68d62', '#a86f4c', '#8d5a3b', '#6b4430', '#4a2e20'];
export const HAIR_COLORS = ['#1a1410', '#3b2718', '#6b4423', '#a8743a', '#d9b36a', '#8c8c8c', '#b3471e'];
export const BAT_COLORS = ['#d8b27a', '#2a1b12', '#6b3a1f', '#1c1c1c', '#c9c1b0', '#7a2c24'];
export const GLOVE_COLORS = ['#7a4a21', '#1c1c1c', '#a0522d', '#c68f4e', '#8b1c1c', '#1d3b72'];

export function newProfile(id: string): PlayerProfile {
  return {
    version: 1,
    id,
    firstName: '',
    lastName: '',
    number: 7,
    primary: 'CF',
    secondary: null,
    bats: 'R',
    throws: 'R',
    hitArchetype: 'fiveTool',
    pitchArchetype: null,
    bonus: {},
    appearance: {
      skin: SKIN_TONES[2],
      hair: 'short',
      hairColor: HAIR_COLORS[1],
      facialHair: 'none',
      build: 'athletic',
      heightIn: 73,
      eyeBlack: false,
      batColor: BAT_COLORS[0],
      gloveColor: GLOVE_COLORS[0],
    },
    createdAt: Date.now(),
  };
}

/** Change positions, keeping archetypes and bonuses consistent with the new role. */
export function setPositions(p: PlayerProfile, primary: UserRole, secondary: UserRole | null): PlayerProfile {
  const next: PlayerProfile = { ...p, primary, secondary };
  if (isHitter(next) && !next.hitArchetype) next.hitArchetype = 'fiveTool';
  if (!isHitter(next)) next.hitArchetype = null;
  if (isPitcher(next) && !next.pitchArchetype) next.pitchArchetype = 'workhorse';
  if (!isPitcher(next)) next.pitchArchetype = null;
  // Drop bonus on ratings that no longer apply, then trim anything over the new caps.
  const keys = relevantKeys(next);
  const bonus: PlayerProfile['bonus'] = {};
  for (const k of keys) if (next.bonus[k]) bonus[k] = next.bonus[k];
  next.bonus = bonus;
  return trimBonus(next);
}

/** Make sure bonuses fit the current caps (after an archetype or role change). */
export function trimBonus(p: PlayerProfile): PlayerProfile {
  let next = { ...p, bonus: { ...p.bonus } };
  for (const k of relevantKeys(next)) {
    const v = next.bonus[k] ?? 0;
    next.bonus[k] = 0;
    next = setBonus(next, k, v);
  }
  return next;
}

/** Normalize a profile loaded from storage (older or hand-edited data). */
export function sanitize(raw: unknown): PlayerProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<PlayerProfile>;
  if (r.version !== 1 || typeof r.id !== 'string' || typeof r.firstName !== 'string') return null;
  const base = newProfile(r.id);
  const p: PlayerProfile = {
    ...base,
    ...r,
    appearance: { ...base.appearance, ...(r.appearance ?? {}) },
    bonus: { ...(r.bonus ?? {}) },
  } as PlayerProfile;
  return trimBonus(setPositions(p, p.primary, p.secondary));
}
