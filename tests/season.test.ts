import { describe, expect, it } from 'vitest';
import { newProfile, setPositions, upgrade, upgradeCost, rating, type PlayerProfile } from '../src/sim/profile';
import {
  advanceDay,
  createSeason,
  daysUntilStart,
  gamesOnDay,
  leaders,
  recordGame,
  seriesWinner,
  simGame,
  simOthersToday,
  standings,
  userGameToday,
  userRoleToday,
  USER_ID,
  type Season,
} from '../src/sim/season';

const twoWay = (): PlayerProfile => setPositions({ ...newProfile('p1'), firstName: 'Jamie', lastName: 'Rivera' }, 'P', 'CF');

function playOut(s: Season, profile: PlayerProfile): { roles: string[]; points: number } {
  const roles: string[] = [];
  let points = 0;
  let guard = 0;
  while (s.phase !== 'done' && guard++ < 500) {
    simOthersToday(s, profile);
    const mine = userGameToday(s);
    roles.push(userRoleToday(s, profile));
    if (mine) points += recordGame(s, mine, simGame(s, mine, profile), { simmed: true });
    advanceDay(s);
  }
  return { roles, points };
}

describe('season', () => {
  const profile = twoWay();
  const fresh = createSeason(profile, { length: 20, innings: 3, difficulty: 'pro', seed: 99 });
  const s = createSeason(profile, { length: 20, innings: 3, difficulty: 'pro', seed: 99 });

  it('builds an 8-team league where everyone plays every day', () => {
    const s = fresh;
    expect(s.teamOrder).toHaveLength(8);
    for (let d = 0; d < 20; d++) expect(gamesOnDay(s, d)).toHaveLength(4);
    for (const id of s.teamOrder) {
      const mine = s.games.filter((g) => g.home === id || g.away === id);
      expect(mine).toHaveLength(20);
      const home = mine.filter((g) => g.home === id).length;
      expect(home).toBeGreaterThanOrEqual(8);
      expect(home).toBeLessThanOrEqual(12);
    }
  });

  it('puts you in the rotation and the lineup as a two-way player', () => {
    const s = fresh;
    const team = s.teams[s.userTeamId];
    expect(team.rotation).toContain(USER_ID);
    expect(team.lineup).toContain(USER_ID);
    expect(daysUntilStart(s)).toBe(0);
    expect(userRoleToday(s, profile)).toBe('pitch');
  });

  const { roles, points } = playOut(s, profile);

  it('plays a whole season with sensible standings', () => {
    const table = standings(s);
    let w = 0;
    let l = 0;
    for (const r of table) {
      expect(r.w + r.l).toBe(20);
      w += r.w;
      l += r.l;
    }
    expect(w).toBe(l);
    expect(table[0].gb).toBe(0);
  });

  it('two-way players start every fifth day and play the field otherwise', () => {
    const regular = roles.slice(0, 20);
    expect(regular.filter((r) => r === 'pitch')).toHaveLength(4);
    expect(regular.filter((r) => r === 'field')).toHaveLength(16);
    expect(s.stats.pitch[USER_ID].gs).toBe(4);
    expect(s.stats.bat[USER_ID].g).toBe(20);
  });

  it('runs the playoffs to a champion', () => {
    expect(s.phase).toBe('done');
    const semis = s.series.filter((x) => x.round === 'semi');
    const final = s.series.find((x) => x.round === 'final')!;
    expect(semis).toHaveLength(2);
    for (const se of semis) expect(Math.max(se.winsA, se.winsB)).toBe(3);
    expect(Math.max(final.winsA, final.winsB)).toBe(4);
    expect(s.champion).toBe(seriesWinner(final));
    const seeds = standings(s).slice(0, 4).map((r) => r.id);
    expect(seeds).toContain(semis[0].a);
    expect(s.awards?.mvp).toBeTruthy();
  });

  it('keeps a game log and awards skill points for your games', () => {
    expect(s.log.length).toBeGreaterThanOrEqual(20);
    expect(points).toBeGreaterThan(0);
    expect(leaders(s).hr.length).toBeGreaterThan(0);
  });

  it('survives a save and load', () => {
    const copy = JSON.parse(JSON.stringify(s)) as Season;
    expect(standings(copy)).toEqual(standings(s));
  });
});

describe('progression', () => {
  it('upgrades cost more as ratings climb and need enough points', () => {
    expect(upgradeCost(60)).toBeLessThan(upgradeCost(80));
    const p = { ...twoWay(), skillPoints: 10 };
    const before = rating(p, 'power');
    const up = upgrade(p, 'power')!;
    expect(rating(up, 'power')).toBe(before + 1);
    expect(up.skillPoints).toBe(10 - upgradeCost(before));
    expect(upgrade({ ...p, skillPoints: 0 }, 'power')).toBeNull();
  });
});
