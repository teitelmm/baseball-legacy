import { describe, expect, it } from 'vitest';
import { FIELD_POSITIONS } from '../src/core/types';
import { simulateBattedBall } from '../src/sim/battedBall';
import { inPlayableArea } from '../src/sim/field';
import { isFoul } from '../src/sim/outcome';
import { PlaySim, simulatePlay, type PlayOutcome, type PlayResult, type PlaySetup } from '../src/sim/playSim';

const fielders = Object.fromEntries(
  FIELD_POSITIONS.map((p) => [p, { id: p, fielding: { speed: 60, arm: 60, glove: 60 } }]),
) as PlaySetup['fielders'];

function setup(ev: number, la: number, spray: number, on: [boolean, boolean, boolean] = [false, false, false], outs = 0): PlaySetup {
  const path = simulateBattedBall({ exitVeloMph: ev, launchAngleDeg: la, sprayDeg: spray, start: { x: 0, y: 3, z: -0.3 } });
  return {
    path,
    foul: isFoul(path),
    fielders,
    batter: { id: 'B', speed: 50 },
    runners: on.map((x, i) => (x ? { id: `R${i + 1}`, speed: 50 } : null)) as PlaySetup['runners'],
    outs,
  };
}

function play(...args: Parameters<typeof setup>): PlayResult {
  const r = simulatePlay(setup(...args));
  expect(r.kind).toBe('play');
  return r as PlayResult;
}

describe('play simulator', () => {
  it('a routine grounder to the left side is out at first', () => {
    const r = play(85, -3, -20);
    expect(r.batterResult).toBe('out');
    expect(r.outKind).toBe('groundout');
    expect(r.chain[r.chain.length - 1]).toBe(3);
    expect(r.outs).toHaveLength(1);
  });

  it('a grounder to short with a runner on first is a 6-4-3 double play', () => {
    const r = play(90, -4, -12, [true, false, false]);
    expect(r.doublePlay).toBe(true);
    expect(r.chain).toEqual([6, 4, 3]);
    expect(r.bases).toEqual([null, null, null]);
    expect(r.description).toContain('double play');
  });

  it('a deep fly with a runner on third and one out is a sacrifice fly', () => {
    const r = play(95, 32, 0, [false, false, true], 1);
    expect(r.batterResult).toBe('out');
    expect(r.sacFly).toBe(true);
    expect(r.scored).toEqual(['R3']);
  });

  it('a line drive to center is a single and the runner advances', () => {
    const r = play(95, 12, 3, [false, true, false]);
    expect(r.batterResult).toBe('single');
    expect(r.bases[0]).toBe('B');
    expect(r.bases[1]).toBeNull();
  });

  it('a home run scores everyone', () => {
    const r = play(110, 28, 5, [true, true, true]);
    expect(r.batterResult).toBe('homeRun');
    expect(r.scored.sort()).toEqual(['B', 'R1', 'R2', 'R3']);
    expect(r.bases).toEqual([null, null, null]);
  });

  it('catches a foul pop up in play', () => {
    const r = play(70, 60, 50);
    expect(r.batterResult).toBe('out');
    expect(r.outKind).toBe('foulout');
  });

  it('a foul ball nobody can reach is just foul', () => {
    const out: PlayOutcome = simulatePlay(setup(100, 15, 60));
    expect(out.kind).toBe('foul');
  });

  it('with two outs the defense takes the force and the run does not count', () => {
    const r = play(85, -3, -20, [true, false, true], 2);
    expect(r.outs).toHaveLength(1);
    expect(r.outs[0].force).toBe(true);
    expect(r.scored).toEqual([]);
  });

  it('hard balls into the gap and down the line are hits', () => {
    for (const [ev, la, spray] of [
      [105, 18, -17],
      [98, 10, -35],
      [106, 22, 17],
    ]) {
      expect(['single', 'double', 'triple']).toContain(play(ev, la, spray).batterResult);
    }
  });

  it('a player-controlled outfielder can run in and make the catch', () => {
    const s = setup(88, 30, 0);
    let sim: PlaySim;
    s.userPosition = 'CF';
    s.control = {
      move: () => {
        const cf = sim.fielders.find((f) => f.pos === 'CF')!;
        const dx = sim.landing.x - cf.x;
        const dz = sim.landing.z - cf.z;
        const d = Math.hypot(dx, dz);
        return d < 1 ? { x: 0, z: 0 } : { x: dx / d, z: dz / d };
      },
      takeThrow: () => 2,
    };
    sim = new PlaySim(s);
    const r = sim.run() as PlayResult;
    expect(r.batterResult).toBe('out');
    expect(r.chain[0]).toBe(8);
  });

  it('a player who stands still lets the ball drop', () => {
    const s = setup(88, 30, -12);
    s.userPosition = 'CF';
    s.control = { move: () => ({ x: 0, z: 0 }), takeThrow: () => null };
    const r = simulatePlay(s) as PlayResult;
    expect(r.batterResult).not.toBe('out');
  });

  it('is deterministic', () => {
    expect(play(97, 8, 20, [true, true, false], 1)).toEqual(play(97, 8, 20, [true, true, false], 1));
  });

  it('fielders never run through the outfield wall on a home run', () => {
    for (const spray of [-40, -20, 0, 20, 40]) {
      const sim = new PlaySim(setup(112, 30, spray));
      while (!sim.done) {
        sim.step();
        for (const f of sim.fielders) expect(inPlayableArea(f)).toBe(true);
      }
      expect((sim.outcome as PlayResult).batterResult).toBe('homeRun');
      // The play wraps up soon after the ball lands instead of making you watch the whole trot.
      expect(sim.t).toBeLessThan(sim.setup.path.landingTime + 3);
    }
  });

  it('a player-controlled outfielder stops at the wall', () => {
    const s = setup(112, 30, 0);
    s.userPosition = 'CF';
    s.control = { move: () => ({ x: 0, z: -1 }), takeThrow: () => null };
    const sim = new PlaySim(s);
    while (!sim.done) sim.step();
    const cf = sim.fielders.find((f) => f.pos === 'CF')!;
    expect(inPlayableArea(cf)).toBe(true);
    expect(Math.hypot(cf.x, cf.z)).toBeGreaterThan(385);
  });

  it('fielders accelerate instead of starting at full speed', () => {
    const sim = new PlaySim(setup(95, 25, -25));
    const lf = sim.fielders.find((f) => f.pos === 'LF')!;
    const speeds: number[] = [];
    while (!sim.done && sim.t < 1.6) {
      sim.step();
      speeds.push(Math.hypot(lf.vx, lf.vz));
    }
    // Standing still during the read, building up over the next second.
    expect(speeds[10]).toBe(0);
    const at = (t: number) => speeds[Math.round(t * 60) - 1];
    expect(at(0.7)).toBeGreaterThan(0);
    expect(at(0.7)).toBeLessThan(at(1.4));
  });

  it('routine plays are almost always made, but not every ball is', () => {
    let routineMade = 0;
    let routine = 0;
    const events = new Set<string>();
    for (let i = 0; i < 160; i++) {
      // Grounders right at the shortstop and lazy flies to center.
      const r = i % 2 ? play(70 + (i % 7), -4 - (i % 5), -14 + (i % 3)) : play(82 + (i % 9), 32 + (i % 4), (i % 5) - 2);
      routine++;
      if (r.batterResult === 'out') routineMade++;
    }
    expect(routineMade / routine).toBeGreaterThan(0.95);
    for (let i = 0; i < 900; i++) {
      const sim = new PlaySim(setup(60 + (i % 50), -15 + ((i * 7) % 60), -40 + ((i * 13) % 80), [i % 3 === 0, false, false]));
      sim.run();
      for (const e of sim.events) events.add(e.type);
    }
    // Over many balls in play, fielders dive, bobble, let balls get past, and sometimes throw wide.
    for (const t of ['dive', 'bobble', 'miss', 'wide']) expect(events.has(t)).toBe(true);
  }, 30000);
});
