import type { DifficultyName } from '../core/constants';
import { DIFFICULTIES } from '../core/constants';
import { Rng } from '../core/rng';
import type { Player, Team } from '../core/types';
import { Game, type TeamBox } from './gameSim';
import { displayName, finalRatings, hittingSpot, isHitter, isPitcher, isTwoWay, positionLabel, type PlayerProfile } from './profile';
import { CPU_TEAM_STYLES, makeTeam, USER_TEAM_STYLE } from './team';

export type SeasonLength = 20 | 40 | 81;

export interface SeasonOptions {
  length: SeasonLength;
  innings: 3 | 6 | 9;
  difficulty: DifficultyName;
  seed: number;
}

export interface GameResult {
  home: number;
  away: number;
  innings: number;
}

export interface SeasonGame {
  id: number;
  day: number;
  home: string;
  away: string;
  result: GameResult | null;
  /** Playoff series index (into `series`), if a playoff game. */
  series?: number;
}

export interface SeriesState {
  round: 'semi' | 'final';
  /** Higher seed first. */
  a: string;
  b: string;
  winsA: number;
  winsB: number;
  bestOf: number;
}

export interface BatTotals {
  g: number;
  ab: number;
  r: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
}

export interface PitchTotals {
  g: number;
  gs: number;
  outs: number;
  h: number;
  r: number;
  bb: number;
  k: number;
  hr: number;
}

export interface StatBook {
  bat: Record<string, BatTotals>;
  pitch: Record<string, PitchTotals>;
}

export interface UserGameLog {
  day: number;
  playoff: boolean;
  opp: string;
  home: boolean;
  won: boolean;
  score: string;
  line: string;
  points: number;
  simmed: boolean;
}

export type DayRole = 'pitch' | 'field' | 'rest';

export interface Season {
  version: 1;
  profileId: string;
  /** Your positions when the season began (a position change needs a new season). */
  roleKey?: string;
  opts: SeasonOptions;
  teams: Record<string, Team>;
  teamOrder: string[];
  userTeamId: string;
  userId: string;
  games: SeasonGame[];
  /** Current day (games on earlier days are all played). */
  day: number;
  regularDays: number;
  rotationIdx: Record<string, number>;
  stats: StatBook;
  postStats: StatBook;
  log: UserGameLog[];
  phase: 'regular' | 'playoffs' | 'done';
  series: SeriesState[];
  champion: string | null;
  awards: { mvp: string | null; cy: string | null } | null;
}

export const USER_TEAM_ID = 'user';
export const USER_ID = 'user-you';

function hashSeed(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b + 0x7f4a7c15), 0x85ebca6b) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

// ---------------------------------------------------------------------------
// Setup

/** Put you on the user team: replace the regular at your spot (kept on the bench) and/or a starter. */
function addUser(team: Team, profile: PlayerProfile): void {
  const r = finalRatings(profile);
  const spot = hittingSpot(profile);
  const you: Player = {
    id: USER_ID,
    name: displayName(profile),
    number: profile.number,
    bats: profile.bats,
    throws: profile.throws,
    pos: spot ?? 'P',
    batting: isHitter(profile) ? { ...r.batting } : { contact: 15, power: 15, eye: 15 },
    fielding: { ...r.fielding },
    isUser: true,
  };
  team.bench = [];
  if (spot) {
    const field = spot as 'LF' | 'CF' | 'RF';
    const replaced = spot === 'DH' ? team.lineup.find((id) => team.players[id].pos === 'DH')! : team.defense[field];
    const order = team.lineup.filter((id) => id !== replaced);
    order.splice(2, 0, USER_ID);
    team.lineup = order;
    if (spot !== 'DH') team.defense[field] = USER_ID;
    team.bench.push(replaced);
  }
  if (isPitcher(profile)) {
    you.pitching = { ...r.pitching };
    you.repertoire = ['FF', 'SI', 'SL', 'CU', 'CH'];
    const rot = team.rotation!;
    delete team.players[rot[0]];
    rot[0] = USER_ID;
  }
  team.players[USER_ID] = you;
}

/** Keep your ratings in the season roster in step with your profile (upgrades). */
export function syncUser(s: Season, profile: PlayerProfile): void {
  const you = s.teams[s.userTeamId].players[USER_ID];
  const r = finalRatings(profile);
  if (isHitter(profile)) you.batting = { ...r.batting };
  you.fielding = { ...r.fielding };
  if (you.pitching) you.pitching = { ...r.pitching };
  you.name = displayName(profile);
  you.number = profile.number;
}

/** Round-robin rounds for an even number of teams (circle method). */
function roundRobin(ids: string[]): Array<Array<[string, string]>> {
  const n = ids.length;
  const arr = [...ids];
  const rounds: Array<Array<[string, string]>> = [];
  for (let r = 0; r < n - 1; r++) {
    const round: Array<[string, string]> = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      round.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(round);
    arr.splice(1, 0, arr.pop()!);
  }
  return rounds;
}

export function createSeason(profile: PlayerProfile, opts: SeasonOptions): Season {
  const rng = new Rng(opts.seed);
  const d = DIFFICULTIES[opts.difficulty];
  const teams: Record<string, Team> = {};
  const user = makeTeam({ id: USER_TEAM_ID, rng, rating: 62, style: USER_TEAM_STYLE });
  addUser(user, profile);
  teams[user.id] = user;
  CPU_TEAM_STYLES.slice(0, 7).forEach((style, i) => {
    // A spread of good and bad teams around the difficulty's level.
    const rating = Math.round(d.cpuRating + [6, 3, 1, 0, -1, -3, -6][i] + rng.gaussian(0, 2));
    const t = makeTeam({ id: `t${i}`, rng, rating, style });
    for (const id of [...t.rotation!, ...t.bullpen!]) {
      const p = t.players[id].pitching!;
      p.velocity = Math.round(Math.max(10, d.cpuPitcherStuff + rng.gaussian(0, 6)));
      p.movement = Math.round(Math.max(10, d.cpuPitcherStuff + rng.gaussian(0, 6)));
    }
    teams[t.id] = t;
  });
  const teamOrder = Object.keys(teams);

  // Schedule: repeat round robins; flip home/away every other cycle.
  const rounds = roundRobin(teamOrder);
  const games: SeasonGame[] = [];
  for (let day = 0; day < opts.length; day++) {
    const round = rounds[day % rounds.length];
    const flip = Math.floor(day / rounds.length) % 2 === 1;
    for (const [h, a] of round) {
      games.push({ id: games.length, day, home: flip ? a : h, away: flip ? h : a, result: null });
    }
  }

  const rotationIdx: Record<string, number> = {};
  for (const id of teamOrder) rotationIdx[id] = 0;

  return {
    version: 1,
    profileId: profile.id,
    roleKey: positionLabel(profile),
    opts,
    teams,
    teamOrder,
    userTeamId: USER_TEAM_ID,
    userId: USER_ID,
    games,
    day: 0,
    regularDays: opts.length,
    rotationIdx,
    stats: { bat: {}, pitch: {} },
    postStats: { bat: {}, pitch: {} },
    log: [],
    phase: 'regular',
    series: [],
    champion: null,
    awards: null,
  };
}

// ---------------------------------------------------------------------------
// Days and games

export function gamesOnDay(s: Season, day = s.day): SeasonGame[] {
  return s.games.filter((g) => g.day === day);
}

export function userGameToday(s: Season): SeasonGame | null {
  return gamesOnDay(s).find((g) => !g.result && (g.home === s.userTeamId || g.away === s.userTeamId)) ?? null;
}

function starterFor(s: Season, teamId: string): string {
  const t = s.teams[teamId];
  const rot = t.rotation ?? [t.pitchers[0]];
  return rot[s.rotationIdx[teamId] % rot.length];
}

/** What you do today: start on the mound, play your position, or rest (a pitcher between starts). */
export function userRoleToday(s: Season, profile: PlayerProfile): DayRole {
  if (!userGameToday(s)) return 'rest';
  if (isPitcher(profile) && starterFor(s, s.userTeamId) === USER_ID) return 'pitch';
  return isHitter(profile) ? 'field' : 'rest';
}

/** Days until your next start (0 = today). */
export function daysUntilStart(s: Season): number | null {
  const t = s.teams[s.userTeamId];
  const rot = t.rotation ?? [];
  const at = rot.indexOf(USER_ID);
  if (at < 0) return null;
  return (at - (s.rotationIdx[s.userTeamId] % rot.length) + rot.length) % rot.length;
}

/** The two teams as they take the field today (today's starter, your role). */
export function buildMatchup(s: Season, g: SeasonGame, profile: PlayerProfile): { home: Team; away: Team } {
  syncUser(s, profile);
  const make = (id: string): Team => {
    const t = s.teams[id];
    const starter = starterFor(s, id);
    const team: Team = { ...t, lineup: [...t.lineup], defense: { ...t.defense }, pitchers: [starter, ...(t.bullpen ?? t.pitchers.slice(1))] };
    if (id === s.userTeamId && isTwoWay(profile) && starter === USER_ID) {
      // Two-way pitching day: you DH, the bench player takes your spot in the field.
      const spot = hittingSpot(profile);
      const benchId = t.bench?.[0];
      if (spot && spot !== 'DH' && benchId) {
        const dh = team.lineup.find((pid) => t.players[pid].pos === 'DH' && pid !== USER_ID);
        team.defense[spot as 'LF' | 'CF' | 'RF'] = benchId;
        if (dh) team.lineup[team.lineup.indexOf(dh)] = benchId;
      }
    }
    return team;
  };
  return { home: make(g.home), away: make(g.away) };
}

export function gameRng(s: Season, g: SeasonGame): Rng {
  return new Rng(hashSeed(s.opts.seed, g.id + 1));
}

function addBox(book: StatBook, box: TeamBox): void {
  for (const l of Object.values(box.batting)) {
    const t = (book.bat[l.id] ??= { g: 0, ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, k: 0 });
    t.g += 1;
    t.ab += l.ab;
    t.r += l.r;
    t.h += l.h;
    t.doubles += l.doubles;
    t.triples += l.triples;
    t.hr += l.hr;
    t.rbi += l.rbi;
    t.bb += l.bb;
    t.k += l.k;
  }
  box.pitchersUsed.forEach((id, i) => {
    const l = box.pitching[id];
    const t = (book.pitch[id] ??= { g: 0, gs: 0, outs: 0, h: 0, r: 0, bb: 0, k: 0, hr: 0 });
    t.g += 1;
    if (i === 0) t.gs += 1;
    t.outs += l.outs;
    t.h += l.h;
    t.r += l.r;
    t.bb += l.bb;
    t.k += l.k;
    t.hr += l.hr;
  });
}

/** Skill points for your game. `fieldingOuts` counts outs you made in live fielding plays. */
export function pointsForGame(g: Game, userId: string, won: boolean, fieldingOuts = 0): number {
  let pts = won ? 1 : 0;
  for (const side of ['away', 'home'] as const) {
    const b = g.box[side].batting[userId];
    if (b) pts += b.h + b.doubles + b.triples * 2 + b.hr * 3 + b.rbi + (b.r + b.bb) * 0.5;
    const p = g.box[side].pitching[userId];
    if (p) pts += p.outs / 3 + p.k * 0.5 + (p.outs >= 15 && p.r <= 3 ? 2 : 0);
  }
  return Math.round(pts + fieldingOuts);
}

/** Record a finished game (played live or simulated). Returns skill points you earned (0 if not your game). */
export function recordGame(s: Season, sg: SeasonGame, g: Game, opts: { simmed?: boolean; fieldingOuts?: number } = {}): number {
  sg.result = { home: g.score.home, away: g.score.away, innings: g.inning };
  const book = sg.series === undefined ? s.stats : s.postStats;
  addBox(book, g.box.away);
  addBox(book, g.box.home);
  for (const id of [sg.home, sg.away]) {
    s.rotationIdx[id] += 1;
  }
  if (sg.series !== undefined) {
    const se = s.series[sg.series];
    const homeWon = g.score.home > g.score.away;
    const winner = homeWon ? sg.home : sg.away;
    if (winner === se.a) se.winsA += 1;
    else se.winsB += 1;
  }
  const userHome = sg.home === s.userTeamId;
  if (!userHome && sg.away !== s.userTeamId) return 0;
  const won = userHome ? g.score.home > g.score.away : g.score.away > g.score.home;
  let points = pointsForGame(g, s.userId, won, opts.fieldingOuts ?? 0);
  if (opts.simmed) points = Math.floor(points / 2);
  s.log.push({
    day: sg.day,
    playoff: sg.series !== undefined,
    opp: s.teams[userHome ? sg.away : sg.home].abbr,
    home: userHome,
    won,
    score: `${won ? 'W' : 'L'} ${Math.max(g.score.home, g.score.away)}-${Math.min(g.score.home, g.score.away)}`,
    line: g.userLine(),
    points,
    simmed: !!opts.simmed,
  });
  return points;
}

/** Simulate a game with no one at the controls. */
export function simGame(s: Season, sg: SeasonGame, profile: PlayerProfile): Game {
  const { home, away } = buildMatchup(s, sg, profile);
  const g = new Game({ home, away, innings: s.opts.innings, rng: gameRng(s, sg), userId: s.userId });
  g.simToEnd();
  return g;
}

/** Simulate every unplayed game today except yours; returns how many were played. */
export function simOthersToday(s: Season, profile: PlayerProfile): number {
  let n = 0;
  for (const sg of gamesOnDay(s)) {
    if (sg.result || sg.home === s.userTeamId || sg.away === s.userTeamId) continue;
    recordGame(s, sg, simGame(s, sg, profile));
    n++;
  }
  return n;
}

/** Move to the next day once today's games are done (starts and advances the playoffs). */
export function advanceDay(s: Season): void {
  if (gamesOnDay(s).some((g) => !g.result)) return;
  s.day += 1;
  if (s.phase === 'regular' && s.day >= s.regularDays) {
    s.awards = computeAwards(s);
    startPlayoffs(s);
  } else if (s.phase === 'playoffs') {
    scheduleSeriesGames(s);
  }
}

// ---------------------------------------------------------------------------
// Standings, leaders, awards

export interface StandingRow {
  id: string;
  name: string;
  abbr: string;
  w: number;
  l: number;
  pct: number;
  gb: number;
  rs: number;
  ra: number;
  streak: string;
}

export function standings(s: Season): StandingRow[] {
  const rows = new Map<string, StandingRow & { results: boolean[] }>();
  for (const id of s.teamOrder) {
    const t = s.teams[id];
    rows.set(id, { id, name: t.name, abbr: t.abbr, w: 0, l: 0, pct: 0, gb: 0, rs: 0, ra: 0, streak: '—', results: [] });
  }
  for (const g of s.games) {
    if (!g.result || g.series !== undefined) continue;
    const h = rows.get(g.home)!;
    const a = rows.get(g.away)!;
    const homeWon = g.result.home > g.result.away;
    h.rs += g.result.home;
    h.ra += g.result.away;
    a.rs += g.result.away;
    a.ra += g.result.home;
    (homeWon ? h : a).w += 1;
    (homeWon ? a : h).l += 1;
    h.results.push(homeWon);
    a.results.push(!homeWon);
  }
  const list = [...rows.values()];
  for (const r of list) {
    r.pct = r.w + r.l ? r.w / (r.w + r.l) : 0;
    const last = r.results[r.results.length - 1];
    if (last !== undefined) {
      let n = 0;
      for (let i = r.results.length - 1; i >= 0 && r.results[i] === last; i--) n++;
      r.streak = `${last ? 'W' : 'L'}${n}`;
    }
  }
  list.sort((x, y) => y.pct - x.pct || y.w - x.w || y.rs - y.ra - (x.rs - x.ra) || x.id.localeCompare(y.id));
  const top = list[0];
  for (const r of list) r.gb = (top.w - r.w + (r.l - top.l)) / 2;
  return list.map(({ results: _r, ...row }) => row);
}

export function avg(b: BatTotals): number {
  return b.ab ? b.h / b.ab : 0;
}

export function obp(b: BatTotals): number {
  return b.ab + b.bb ? (b.h + b.bb) / (b.ab + b.bb) : 0;
}

export function slg(b: BatTotals): number {
  const singles = b.h - b.doubles - b.triples - b.hr;
  return b.ab ? (singles + 2 * b.doubles + 3 * b.triples + 4 * b.hr) / b.ab : 0;
}

/** Runs allowed per nine innings. */
export function ra9(p: PitchTotals): number {
  return p.outs ? (p.r * 27) / p.outs : 0;
}

export function playerName(s: Season, id: string): { name: string; team: string } {
  for (const t of Object.values(s.teams)) {
    const p = t.players[id];
    if (p) return { name: p.name, team: t.abbr };
  }
  return { name: '?', team: '' };
}

function teamGamesPlayed(s: Season): number {
  return Math.max(1, Math.min(s.day, s.regularDays));
}

/** Qualifying minimums scale with games played and game length. */
function qualifiers(s: Season): { ab: number; outs: number } {
  const g = teamGamesPlayed(s) * (s.opts.innings / 9);
  return { ab: g * 2.5, outs: g * 2.4 };
}

export interface LeaderRow {
  id: string;
  name: string;
  team: string;
  value: number;
  text: string;
}

export function leaders(s: Season, n = 5): Record<'avg' | 'hr' | 'rbi' | 'k' | 'ra9', LeaderRow[]> {
  const { ab: minAb, outs: minOuts } = qualifiers(s);
  const bat = Object.entries(s.stats.bat);
  const pitch = Object.entries(s.stats.pitch);
  const row = (id: string, value: number, text: string): LeaderRow => ({ id, ...playerName(s, id), value, text });
  const top = <T>(list: Array<[string, T]>, score: (t: T) => number, text: (t: T) => string, asc = false) =>
    list
      .map(([id, t]) => row(id, score(t), text(t)))
      .sort((a, b) => (asc ? a.value - b.value : b.value - a.value))
      .slice(0, n);
  const avg3 = (v: number) => (v >= 1 ? v.toFixed(3) : v.toFixed(3).slice(1));
  return {
    avg: top(bat.filter(([, b]) => b.ab >= minAb), avg, (b) => avg3(avg(b))),
    hr: top(bat, (b) => b.hr, (b) => String(b.hr)),
    rbi: top(bat, (b) => b.rbi, (b) => String(b.rbi)),
    k: top(pitch, (p) => p.k, (p) => String(p.k)),
    ra9: top(pitch.filter(([, p]) => p.outs >= minOuts), ra9, (p) => ra9(p).toFixed(2), true),
  };
}

function computeAwards(s: Season): { mvp: string | null; cy: string | null } {
  const q = qualifiers(s);
  let mvp: string | null = null;
  let best = -1;
  for (const [id, b] of Object.entries(s.stats.bat)) {
    if (b.ab < q.ab) continue;
    const score = obp(b) + slg(b) + b.hr * 0.004 + b.rbi * 0.002;
    if (score > best) {
      best = score;
      mvp = id;
    }
  }
  let cy: string | null = null;
  let low = Infinity;
  for (const [id, p] of Object.entries(s.stats.pitch)) {
    if (p.outs < q.outs) continue;
    const score = ra9(p) - p.k * 0.01;
    if (score < low) {
      low = score;
      cy = id;
    }
  }
  return { mvp, cy };
}

// ---------------------------------------------------------------------------
// Playoffs: top four, semis best-of-5 (2-2-1), final best-of-7 (2-3-2)

function startPlayoffs(s: Season): void {
  const seeds = standings(s).map((r) => r.id);
  s.phase = 'playoffs';
  s.series = [
    { round: 'semi', a: seeds[0], b: seeds[3], winsA: 0, winsB: 0, bestOf: 5 },
    { round: 'semi', a: seeds[1], b: seeds[2], winsA: 0, winsB: 0, bestOf: 5 },
  ];
  scheduleSeriesGames(s);
}

export function seriesWinner(se: SeriesState): string | null {
  const need = Math.ceil(se.bestOf / 2);
  return se.winsA >= need ? se.a : se.winsB >= need ? se.b : null;
}

function higherSeedHome(bestOf: number, gameNo: number): boolean {
  // gameNo is 1-based.
  if (bestOf === 5) return [1, 2, 5].includes(gameNo);
  return [1, 2, 6, 7].includes(gameNo);
}

function scheduleSeriesGames(s: Season): void {
  const semis = s.series.filter((x) => x.round === 'semi');
  const final = s.series.find((x) => x.round === 'final');
  if (!final && semis.every((x) => seriesWinner(x))) {
    s.series.push({ round: 'final', a: seriesWinner(semis[0])!, b: seriesWinner(semis[1])!, winsA: 0, winsB: 0, bestOf: 7 });
  }
  const fin = s.series.find((x) => x.round === 'final');
  if (fin && seriesWinner(fin)) {
    s.champion = seriesWinner(fin);
    s.phase = 'done';
    return;
  }
  s.series.forEach((se, i) => {
    if (seriesWinner(se)) return;
    if (se.round === 'final' && semis.some((x) => !seriesWinner(x))) return;
    const gameNo = se.winsA + se.winsB + 1;
    const aHome = higherSeedHome(se.bestOf, gameNo);
    s.games.push({ id: s.games.length, day: s.day, home: aHome ? se.a : se.b, away: aHome ? se.b : se.a, result: null, series: i });
  });
}

/** Is your team still alive in the playoffs (or in the regular season)? */
export function userStillPlaying(s: Season): boolean {
  if (s.phase === 'regular') return true;
  if (s.phase === 'done') return false;
  return s.series.some((se) => !seriesWinner(se) && (se.a === s.userTeamId || se.b === s.userTeamId));
}
