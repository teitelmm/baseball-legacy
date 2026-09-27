/**
 * Three-click pitching meter.
 *   click 1: the meter starts rising from the accuracy line (0).
 *   click 2: sets power (0..MAX_POWER). Above 1.0 is "max effort".
 *   click 3: as the meter falls back, clicking on the accuracy line is perfect.
 *            Early clicks (above the line) and late clicks (below) miss.
 * Times are in seconds on whatever clock the caller uses.
 */
export const MAX_POWER = 1.1;
export const LATE_LIMIT = -0.2;
export const RISE_RATE = 1.15; // meter units per second at speed 1
export const FALL_RATE = 1.5;

export type MeterPhase = 'idle' | 'rising' | 'falling' | 'done';

export interface MeterResult {
  power: number;
  /** Signed distance from the accuracy line: > 0 early, < 0 late. */
  accuracy: number;
}

export class PitchMeter {
  phase: MeterPhase = 'idle';
  private startTime = 0;
  private powerTime = 0;
  power = 0;
  result: MeterResult | null = null;

  constructor(private speed = 1) {}

  value(now: number): number {
    switch (this.phase) {
      case 'idle':
        return 0;
      case 'rising':
        return Math.min(MAX_POWER, (now - this.startTime) * RISE_RATE * this.speed);
      case 'falling':
        return Math.max(LATE_LIMIT, this.power - (now - this.powerTime) * FALL_RATE * this.speed);
      case 'done':
        return this.result?.accuracy ?? 0;
    }
  }

  /** Advance automatic transitions (topping out, falling past the line). */
  update(now: number): void {
    if (this.phase === 'rising' && this.value(now) >= MAX_POWER) {
      this.setPower(now, MAX_POWER);
    }
    if (this.phase === 'falling' && this.value(now) <= LATE_LIMIT) {
      this.finish(LATE_LIMIT);
    }
  }

  click(now: number): MeterPhase {
    this.update(now);
    switch (this.phase) {
      case 'idle':
        this.phase = 'rising';
        this.startTime = now;
        break;
      case 'rising':
        this.setPower(now, this.value(now));
        break;
      case 'falling':
        this.finish(this.value(now));
        break;
      case 'done':
        break;
    }
    return this.phase;
  }

  private setPower(now: number, power: number): void {
    this.power = power;
    this.powerTime = now;
    this.phase = 'falling';
  }

  private finish(accuracy: number): void {
    this.result = { power: this.power, accuracy };
    this.phase = 'done';
  }
}

/** Extra mph from going into the max-effort zone. */
export function effortBonusMph(power: number): number {
  return Math.max(0, power - 1) * 15;
}

/** Velocity multiplier from the power click (0.9 at zero power, 1.0 at full). */
export function powerSpeedFactor(power: number): number {
  return 0.9 + 0.1 * Math.min(1, Math.max(0, power));
}

/**
 * Miss distance in inches for a meter result.
 * controlRating 0-100; errorScale comes from difficulty.
 */
export function missInches(result: MeterResult, controlRating: number, errorScale = 1): number {
  const controlFactor = 1.35 - (controlRating / 100) * 0.7; // 1.35 (bad) .. 0.65 (elite)
  const effort = 1 + Math.max(0, result.power - 1) * 6; // up to 1.6x
  const accuracyMiss = Math.abs(result.accuracy) * 45; // 0.1 off the line ~ 4.5 in
  const base = 0.8;
  return (base + accuracyMiss) * controlFactor * effort * errorScale;
}
