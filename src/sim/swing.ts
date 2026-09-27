import { INCH } from '../core/constants';
import type { Rng } from '../core/rng';
import type { Handedness, PlateLoc, SwingType } from '../core/types';

export interface SwingParams {
  /** Multipliers from difficulty (1 = baseline). */
  timingScale: number;
  pciScale: number;
  /** Fraction (0-1) the PCI is pulled toward the ball before judging location. */
  contactAssist?: number;
}

export const BASE_PCI = {
  innerHalfW: 2.6, // inches
  innerHalfH: 2.0,
  outerHalfW: 7.5,
  outerHalfH: 5.5,
};

export const BASE_TIMING = {
  perfect: 20, // ms
  good: 50,
  ok: 95,
  whiff: 150,
};

export interface SwingInput {
  type: SwingType;
  pci: PlateLoc;
  /** Bat arrival minus ball arrival, ms. Negative = early. */
  timingErrorMs: number;
}

export interface SwingContext {
  ballLoc: PlateLoc;
  pitchSpeedMph: number;
  bats: Handedness;
  contactRating: number;
  powerRating: number;
  params: SwingParams;
}

export type TimingLabel = 'Very Early' | 'Early' | 'Perfect' | 'Late' | 'Very Late' | 'Good';

export interface ContactResult {
  kind: 'contact';
  exitVeloMph: number;
  launchAngleDeg: number;
  /** Spray angle in degrees: 0 = center field, negative = left field, positive = right field. */
  sprayDeg: number;
  quality: number;
  timingLabel: TimingLabel;
  contactLabel: string;
  timingErrorMs: number;
}

export type SwingResult =
  | { kind: 'whiff'; reason: 'timing' | 'location'; timingLabel: TimingLabel; timingErrorMs: number }
  | { kind: 'foulTip'; timingLabel: TimingLabel; timingErrorMs: number }
  | ContactResult;

export function pciSize(type: SwingType, contactRating: number, params: SwingParams) {
  const ratingScale = 0.8 + (contactRating / 100) * 0.4;
  const typeScale = type === 'power' ? 0.75 : 1;
  const s = ratingScale * typeScale * params.pciScale;
  return {
    innerHalfW: BASE_PCI.innerHalfW * s,
    innerHalfH: BASE_PCI.innerHalfH * s,
    outerHalfW: BASE_PCI.outerHalfW * s,
    outerHalfH: BASE_PCI.outerHalfH * s,
  };
}

export function timingWindows(type: SwingType, params: SwingParams) {
  const s = params.timingScale * (type === 'power' ? 0.8 : 1);
  return {
    perfect: BASE_TIMING.perfect * s,
    good: BASE_TIMING.good * s,
    ok: BASE_TIMING.ok * s,
    whiff: BASE_TIMING.whiff * s,
  };
}

export function timingLabel(dt: number, w: ReturnType<typeof timingWindows>): TimingLabel {
  const a = Math.abs(dt);
  if (a <= w.perfect) return 'Perfect';
  if (a <= w.good) return 'Good';
  if (dt < 0) return a <= w.ok ? 'Early' : 'Very Early';
  return a <= w.ok ? 'Late' : 'Very Late';
}

/** Evaluate a swing against the pitch. Pure except for small rng noise. */
export function evaluateSwing(input: SwingInput, ctx: SwingContext, rng: Rng): SwingResult {
  const w = timingWindows(input.type, ctx.params);
  const dt = input.timingErrorMs;
  const tLabel = timingLabel(dt, w);

  if (Math.abs(dt) > w.whiff) {
    return { kind: 'whiff', reason: 'timing', timingLabel: tLabel, timingErrorMs: dt };
  }

  const pci = pciSize(input.type, ctx.contactRating, ctx.params);
  // Offset of the ball from the PCI center, inches. dy > 0 means the ball is above the PCI.
  // Contact assist (easier difficulties) shrinks the miss before it's judged.
  const keep = 1 - Math.min(1, Math.max(0, ctx.params.contactAssist ?? 0));
  const dx = ((ctx.ballLoc.x - input.pci.x) * keep) / INCH;
  const dy = ((ctx.ballLoc.y - input.pci.y) * keep) / INCH;
  const nd = Math.hypot(dx / pci.outerHalfW, dy / pci.outerHalfH);
  if (nd > 1) {
    return { kind: 'whiff', reason: 'location', timingLabel: tLabel, timingErrorMs: dt };
  }

  const innerNorm = Math.hypot(pci.innerHalfW / pci.outerHalfW, pci.innerHalfH / pci.outerHalfH) / Math.SQRT2;
  const spatialQ = nd <= innerNorm ? 1 : 1 - (nd - innerNorm) / (1 - innerNorm);
  const absDt = Math.abs(dt);
  const timingQ = absDt <= w.perfect ? 1 : Math.max(0, 1 - (absDt - w.perfect) / (w.whiff - w.perfect));
  const quality = spatialQ * (0.25 + 0.75 * timingQ);

  if (quality < 0.07) {
    return { kind: 'foulTip', timingLabel: tLabel, timingErrorMs: dt };
  }

  // Exit velocity.
  const maxEv = 94 + (ctx.powerRating / 100) * 16 + (input.type === 'power' ? 4 : 0);
  const pitchBonus = (ctx.pitchSpeedMph - 88) * 0.15;
  const ev = 38 + (maxEv + pitchBonus - 38) * Math.pow(quality, 0.65) + rng.gaussian(0, 1.5);

  // Launch angle: the bat under the ball (ball above PCI) lifts it; over the ball tops it.
  const la = 11 + 5.5 * dy + 0.35 * dy * Math.abs(dy) + rng.gaussian(0, 2.5) - (dt > 0 ? (dt / w.ok) * 4 : 0);

  // Spray: early pulls, late goes the other way. "Pull" is positive here. It scales with
  // the timing window, so the edge of the "OK" window is still fair on every difficulty.
  const pull = 3 - (dt / w.ok) * 32 + rng.gaussian(0, 4);
  const sprayDeg = ctx.bats === 'R' ? -pull : pull;

  const contactLabel =
    quality > 0.85 ? 'Perfect' : quality > 0.65 ? 'Solid' : quality > 0.4 ? 'Fair' : quality > 0.2 ? 'Weak' : 'Mishit';

  return {
    kind: 'contact',
    exitVeloMph: Math.max(20, ev),
    launchAngleDeg: Math.max(-70, Math.min(85, la)),
    sprayDeg,
    quality,
    timingLabel: tLabel,
    contactLabel,
    timingErrorMs: dt,
  };
}
