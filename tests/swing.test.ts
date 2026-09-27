import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, INCH } from '../src/core/constants';
import { Rng } from '../src/core/rng';
import { evaluateSwing, type SwingContext } from '../src/sim/swing';

const ROOKIE = {
  timingScale: DIFFICULTIES.rookie.timingScale,
  pciScale: DIFFICULTIES.rookie.pciScale,
  contactAssist: DIFFICULTIES.rookie.contactAssist,
};

const ctx = (over: Partial<SwingContext> = {}): SwingContext => ({
  ballLoc: { x: 0, y: 2.5 },
  pitchSpeedMph: 92,
  bats: 'R',
  contactRating: 70,
  powerRating: 70,
  params: { timingScale: 1, pciScale: 1 },
  ...over,
});

describe('swing contact model', () => {
  it('perfect timing on a centered PCI is hard, fairly straight contact', () => {
    const r = evaluateSwing({ type: 'normal', pci: { x: 0, y: 2.5 }, timingErrorMs: 0 }, ctx(), new Rng(1));
    expect(r.kind).toBe('contact');
    if (r.kind !== 'contact') return;
    expect(r.exitVeloMph).toBeGreaterThan(100);
    expect(Math.abs(r.sprayDeg)).toBeLessThan(15);
    expect(r.launchAngleDeg).toBeGreaterThan(0);
    expect(r.launchAngleDeg).toBeLessThan(25);
    expect(r.timingLabel).toBe('Perfect');
  });

  it('early swings pull the ball (left field for a righty, right field for a lefty)', () => {
    const r = evaluateSwing({ type: 'normal', pci: { x: 0, y: 2.5 }, timingErrorMs: -50 }, ctx(), new Rng(2));
    const l = evaluateSwing({ type: 'normal', pci: { x: 0, y: 2.5 }, timingErrorMs: -50 }, ctx({ bats: 'L' }), new Rng(2));
    expect(r.kind === 'contact' && r.sprayDeg < -10).toBe(true);
    expect(l.kind === 'contact' && l.sprayDeg > 10).toBe(true);
  });

  it('late swings go the other way', () => {
    const r = evaluateSwing({ type: 'normal', pci: { x: 0, y: 2.5 }, timingErrorMs: 50 }, ctx(), new Rng(3));
    expect(r.kind === 'contact' && r.sprayDeg > 10).toBe(true);
  });

  it('a PCI above the ball tops it into the ground; below the ball lifts it', () => {
    const over = evaluateSwing({ type: 'normal', pci: { x: 0, y: 2.5 + 4 * INCH }, timingErrorMs: 0 }, ctx(), new Rng(4));
    const under = evaluateSwing({ type: 'normal', pci: { x: 0, y: 2.5 - 4 * INCH }, timingErrorMs: 0 }, ctx(), new Rng(4));
    expect(over.kind === 'contact' && over.launchAngleDeg < 0).toBe(true);
    expect(under.kind === 'contact' && under.launchAngleDeg > 30).toBe(true);
  });

  it('whiffs when the ball is outside the PCI', () => {
    const r = evaluateSwing({ type: 'normal', pci: { x: 1.0, y: 2.5 }, timingErrorMs: 0 }, ctx(), new Rng(5));
    expect(r).toMatchObject({ kind: 'whiff', reason: 'location' });
  });

  it('whiffs when timing is way off', () => {
    const r = evaluateSwing({ type: 'normal', pci: { x: 0, y: 2.5 }, timingErrorMs: -300 }, ctx(), new Rng(6));
    expect(r).toMatchObject({ kind: 'whiff', reason: 'timing' });
  });

  it('power swings hit harder but have a smaller PCI', () => {
    const n = evaluateSwing({ type: 'normal', pci: { x: 0, y: 2.5 }, timingErrorMs: 0 }, ctx(), new Rng(7));
    const p = evaluateSwing({ type: 'power', pci: { x: 0, y: 2.5 }, timingErrorMs: 0 }, ctx(), new Rng(7));
    expect(n.kind === 'contact' && p.kind === 'contact' && p.exitVeloMph > n.exitVeloMph).toBe(true);
    const edge = { x: 7 * INCH, y: 2.5 };
    expect(evaluateSwing({ type: 'normal', pci: edge, timingErrorMs: 0 }, ctx(), new Rng(8)).kind).not.toBe('whiff');
    expect(evaluateSwing({ type: 'power', pci: edge, timingErrorMs: 0 }, ctx(), new Rng(8)).kind).toBe('whiff');
  });

  it('easier difficulty widens the timing window', () => {
    const hard = evaluateSwing({ type: 'normal', pci: { x: 0, y: 2.5 }, timingErrorMs: -170 }, ctx(), new Rng(9));
    const easy = evaluateSwing(
      { type: 'normal', pci: { x: 0, y: 2.5 }, timingErrorMs: -170 },
      ctx({ params: ROOKIE }),
      new Rng(9),
    );
    expect(hard.kind).toBe('whiff');
    expect(easy.kind).not.toBe('whiff');
  });

  it('contact assist turns a near miss into contact', () => {
    const edge = { x: 0.85, y: 2.5 }; // ball 10+ inches outside the PCI center
    const plain = evaluateSwing({ type: 'normal', pci: edge, timingErrorMs: 0 }, ctx({ params: { timingScale: 1, pciScale: 1 } }), new Rng(10));
    const assisted = evaluateSwing(
      { type: 'normal', pci: edge, timingErrorMs: 0 },
      ctx({ params: { timingScale: 1, pciScale: 1, contactAssist: 0.4 } }),
      new Rng(10),
    );
    expect(plain.kind).toBe('whiff');
    expect(assisted.kind).toBe('contact');
  });

  it('on Rookie a swing 120 ms late is still fair contact', () => {
    for (let seed = 0; seed < 20; seed++) {
      const r = evaluateSwing({ type: 'normal', pci: { x: 0, y: 2.5 }, timingErrorMs: 120 }, ctx({ params: ROOKIE }), new Rng(seed));
      expect(r.kind).toBe('contact');
      if (r.kind === 'contact') expect(Math.abs(r.sprayDeg)).toBeLessThan(45);
    }
  });

  it('spray at the edge of the OK window stays fair on every difficulty', () => {
    for (const d of Object.values(DIFFICULTIES)) {
      const params = { timingScale: d.timingScale, pciScale: d.pciScale };
      const ok = 95 * d.timingScale;
      for (const dt of [-ok, ok]) {
        const r = evaluateSwing({ type: 'normal', pci: { x: 0, y: 2.5 }, timingErrorMs: dt }, ctx({ params }), new Rng(11));
        expect(r.kind).toBe('contact');
        if (r.kind === 'contact') expect(Math.abs(r.sprayDeg)).toBeLessThan(45);
      }
    }
  });
});
