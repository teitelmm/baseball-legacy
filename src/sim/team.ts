import type { Rng } from '../core/rng';
import type {
  BattingRatings,
  FieldingRatings,
  Handedness,
  PitchingRatings,
  PitchTypeId,
  Player,
  Position,
  Team,
  TeamColors,
} from '../core/types';

const FIRST = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'R', 'S', 'T', 'V', 'W'];
const LAST = [
  'Alvarez', 'Brooks', 'Nakamura', 'Okafor', 'Castillo', 'Whitfield', 'Moreau', 'Park', 'Ramirez', 'Lindqvist',
  'Harper', 'Delgado', 'Fischer', 'Mendoza', 'Sato', 'Kowalski', 'Bennett', 'Ortega', 'Reyes', 'Hayes',
  'Vasquez', 'Tanaka', 'Murphy', 'Silva', 'Novak', 'Grant', 'Ibarra', 'Chen', 'Duarte', 'Walsh',
  'Moss', 'Quintana', 'Abreu', 'Holt', 'Jensen', 'Kim', 'Lopez', 'Price', 'Rivera', 'Young',
];

export const CPU_TEAM_STYLES: Array<{ name: string; abbr: string; colors: TeamColors }> = [
  { name: 'Harbor City Gulls', abbr: 'HCG', colors: { jersey: '#9aa3ad', pants: '#b8bfc7', cap: '#b3261e', accent: '#b3261e' } },
  { name: 'Mesa Roadrunners', abbr: 'MES', colors: { jersey: '#e9dcc2', pants: '#e9dcc2', cap: '#c2571a', accent: '#1f5c5a' } },
  { name: 'Northfield Pines', abbr: 'NFP', colors: { jersey: '#2f5d3a', pants: '#d9d6cc', cap: '#1b3322', accent: '#e0b84a' } },
  { name: 'River Valley Stars', abbr: 'RVS', colors: { jersey: '#1f2a44', pants: '#c7ccd6', cap: '#1f2a44', accent: '#e8c547' } },
];

export const USER_TEAM_STYLE = {
  name: 'Legacy City Legends',
  abbr: 'LCL',
  colors: { jersey: '#f4f4f0', pants: '#f0f0ea', cap: '#1d3b72', accent: '#1d3b72' } as TeamColors,
};

const clamp = (v: number) => Math.round(Math.max(20, Math.min(99, v)));

function name(rng: Rng): string {
  return `${rng.pick(FIRST)}. ${rng.pick(LAST)}`;
}

function batting(rng: Rng, r: number): BattingRatings {
  return { contact: clamp(rng.gaussian(r, 9)), power: clamp(rng.gaussian(r, 11)), eye: clamp(rng.gaussian(r, 9)) };
}

const FIELD_PROFILE: Record<Position, [number, number, number]> = {
  // [speed, arm, glove] offsets
  P: [-10, 5, -5],
  C: [-15, 12, 5],
  '1B': [-12, -5, -5],
  '2B': [5, -5, 10],
  SS: [8, 10, 12],
  '3B': [-3, 12, 5],
  LF: [0, -3, -3],
  CF: [12, 3, 8],
  RF: [2, 12, 0],
  DH: [-12, -10, -15],
};

export function fielding(rng: Rng, pos: Position, base = 60): FieldingRatings {
  const [s, a, g] = FIELD_PROFILE[pos];
  return { speed: clamp(rng.gaussian(base + s, 10)), arm: clamp(rng.gaussian(base + a, 10)), glove: clamp(rng.gaussian(base + g, 10)) };
}

function repertoire(rng: Rng): PitchTypeId[] {
  const fastball: PitchTypeId = rng.chance(0.65) ? 'FF' : 'SI';
  const others = (['SL', 'CU', 'CH'] as PitchTypeId[]).filter(() => rng.chance(0.7));
  if (others.length < 2) others.push(...(['SL', 'CH'] as PitchTypeId[]).filter((p) => !others.includes(p)));
  return [fastball, ...others];
}

function pitching(rng: Rng, r: number, starter: boolean): PitchingRatings & { stamina: number } {
  return {
    velocity: clamp(rng.gaussian(r, 9)),
    control: clamp(rng.gaussian(r, 9)),
    movement: clamp(rng.gaussian(r, 9)),
    stamina: starter ? clamp(rng.gaussian(80, 7)) : clamp(rng.gaussian(35, 8)),
  };
}

let idCounter = 0;

function makePlayer(rng: Rng, teamId: string, pos: Position, r: number, used: Set<number>): Player {
  let number = 1 + Math.floor(rng.next() * 60);
  while (used.has(number)) number = 1 + Math.floor(rng.next() * 60);
  used.add(number);
  const bats: Handedness = rng.chance(0.3) ? 'L' : 'R';
  const throws: Handedness = pos === 'P' ? (rng.chance(0.28) ? 'L' : 'R') : rng.chance(0.1) && !['C', '2B', 'SS', '3B'].includes(pos) ? 'L' : 'R';
  const p: Player = {
    id: `${teamId}-${pos}-${idCounter++}`,
    name: name(rng),
    number,
    bats,
    throws,
    pos,
    batting: pos === 'P' ? { contact: 15, power: 15, eye: 15 } : batting(rng, r),
    fielding: fielding(rng, pos),
  };
  return p;
}

const LINEUP_POSITIONS: Array<Exclude<Position, 'P'>> = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];

export interface TeamOptions {
  id: string;
  rng: Rng;
  /** Overall quality 0-100. */
  rating: number;
  style: { name: string; abbr: string; colors: TeamColors };
}

/** Order hitters: best on-base types at the top, power in the middle. */
function battingOrder(players: Player[]): string[] {
  const score = (p: Player) => p.batting.contact * 0.45 + p.batting.eye * 0.2 + p.batting.power * 0.35;
  const sorted = [...players].sort((a, b) => score(b) - score(a));
  // Best three hit 2-3-4, next best lead off, rest follow.
  const order = [sorted[3], sorted[0], sorted[1], sorted[2], ...sorted.slice(4)];
  return order.map((p) => p.id);
}

export function makeTeam(o: TeamOptions): Team {
  const used = new Set<number>();
  const players: Record<string, Player> = {};
  const defense = {} as Team['defense'];
  const hitters: Player[] = [];
  for (const pos of LINEUP_POSITIONS) {
    const p = makePlayer(o.rng, o.id, pos, o.rating, used);
    players[p.id] = p;
    hitters.push(p);
    if (pos !== 'DH') defense[pos] = p.id;
  }
  const pitchers: string[] = [];
  for (let i = 0; i < 6; i++) {
    const p = makePlayer(o.rng, o.id, 'P', o.rating, used);
    p.pitching = pitching(o.rng, o.rating - (i === 0 ? 0 : 3), i === 0);
    p.repertoire = repertoire(o.rng);
    players[p.id] = p;
    pitchers.push(p.id);
  }
  return { id: o.id, name: o.style.name, abbr: o.style.abbr, colors: o.style.colors, players, lineup: battingOrder(hitters), defense, pitchers };
}

export type UserRole = 'LF' | 'CF' | 'RF' | 'DH' | 'P';

export interface UserPlayerSpec {
  name: string;
  number: number;
  /** Today's position: a hitting spot, or P. */
  role: UserRole;
  /** On a pitching day, a two-way player also bats (as the DH). */
  alsoBats?: boolean;
  bats: Handedness;
  throws: Handedness;
  batting: BattingRatings;
  fielding: FieldingRatings;
  pitching: PitchingRatings & { stamina: number };
  repertoire?: PitchTypeId[];
}

/** Your team: a generated roster with you in your spot (batting 3rd if you hit). */
export function makeUserTeam(rng: Rng, rating: number, spec: UserPlayerSpec): { team: Team; userId: string } {
  const team = makeTeam({ id: 'user', rng, rating, style: USER_TEAM_STYLE });
  const userId = 'user-you';
  const hits = spec.role !== 'P' || !!spec.alsoBats;
  const you: Player = {
    id: userId,
    name: spec.name,
    number: spec.number,
    bats: spec.bats,
    throws: spec.throws,
    pos: spec.role,
    batting: hits ? { ...spec.batting } : { contact: 15, power: 15, eye: 15 },
    fielding: { ...spec.fielding },
    isUser: true,
  };
  if (spec.role === 'P') {
    you.pitching = { ...spec.pitching };
    you.repertoire = spec.repertoire ?? ['FF', 'SI', 'SL', 'CU', 'CH'];
    const replaced = team.pitchers[0];
    delete team.players[replaced];
    team.pitchers[0] = userId;
  }
  if (hits) {
    // Replace the player at your spot (the DH on a two-way pitching day) and bat 3rd.
    const spot = spec.role === 'P' || spec.role === 'DH' ? 'DH' : spec.role;
    const replacedId = spot === 'DH' ? team.lineup.find((id) => team.players[id].pos === 'DH')! : team.defense[spot];
    delete team.players[replacedId];
    const order = team.lineup.filter((id) => id !== replacedId);
    order.splice(2, 0, userId);
    team.lineup = order;
    if (spot !== 'DH') team.defense[spot] = userId;
  }
  team.players[userId] = you;
  return { team, userId };
}
