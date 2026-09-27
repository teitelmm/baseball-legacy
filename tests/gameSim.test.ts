import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { Game } from '../src/sim/gameSim';
import { CPU_TEAM_STYLES, makeTeam } from '../src/sim/team';

function playGames(n: number, innings = 9) {
  const totals = { runs: 0, pa: 0, ab: 0, h: 0, doubles: 0, triples: 0, hr: 0, bb: 0, k: 0, games: 0, pitches: 0 };
  const games: Game[] = [];
  for (let i = 0; i < n; i++) {
    const rng = new Rng(1000 + i);
    const home = makeTeam({ id: 'h', rng, rating: 60, style: CPU_TEAM_STYLES[0] });
    const away = makeTeam({ id: 'a', rng, rating: 60, style: CPU_TEAM_STYLES[1] });
    const g = new Game({ home, away, innings, rng });
    g.simToEnd();
    games.push(g);
    totals.games++;
    totals.runs += g.score.home + g.score.away;
    for (const side of ['home', 'away'] as const) {
      for (const l of Object.values(g.box[side].batting)) {
        totals.ab += l.ab;
        totals.h += l.h;
        totals.doubles += l.doubles;
        totals.triples += l.triples;
        totals.hr += l.hr;
        totals.bb += l.bb;
        totals.k += l.k;
      }
      for (const l of Object.values(g.box[side].pitching)) totals.pitches += l.pitches;
    }
  }
  totals.pa = totals.ab + totals.bb;
  return { totals, games };
}

describe('game engine', () => {
  const { totals, games } = playGames(60);
  const perTeamGame = totals.runs / (2 * totals.games);
  const avg = totals.h / totals.ab;
  const kPct = totals.k / totals.pa;
  const bbPct = totals.bb / totals.pa;
  const hrPerGame = totals.hr / totals.games;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      runsPerTeamGame: perTeamGame.toFixed(2),
      avg: avg.toFixed(3),
      kPct: kPct.toFixed(3),
      bbPct: bbPct.toFixed(3),
      hrPerGame: hrPerGame.toFixed(2),
      doublesPerGame: (totals.doubles / totals.games).toFixed(2),
      triplesPerGame: (totals.triples / totals.games).toFixed(2),
      pitchesPerGame: (totals.pitches / totals.games).toFixed(0),
    }),
  );

  it('produces realistic totals', () => {
    expect(perTeamGame).toBeGreaterThan(3);
    expect(perTeamGame).toBeLessThan(6);
    expect(avg).toBeGreaterThan(0.22);
    expect(avg).toBeLessThan(0.29);
    expect(kPct).toBeGreaterThan(0.15);
    expect(kPct).toBeLessThan(0.28);
    expect(bbPct).toBeGreaterThan(0.05);
    expect(bbPct).toBeLessThan(0.12);
    expect(hrPerGame).toBeGreaterThan(0.5);
    expect(hrPerGame).toBeLessThan(3);
  });

  it('every game ends with a winner and the box score matches the line score', () => {
    for (const g of games) {
      expect(g.over).toBe(true);
      expect(g.score.home).not.toBe(g.score.away);
      expect(g.inning).toBeGreaterThanOrEqual(9);
      for (const side of ['home', 'away'] as const) {
        const lineRuns = g.lineScore[side].filter((x) => !Number.isNaN(x)).reduce((a, b) => a + b, 0);
        const boxRuns = Object.values(g.box[side].batting).reduce((a, l) => a + l.r, 0);
        expect(lineRuns).toBe(g.score[side]);
        expect(boxRuns).toBe(g.score[side]);
      }
    }
  });
});
