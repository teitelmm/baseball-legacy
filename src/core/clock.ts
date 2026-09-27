/**
 * Game clock in milliseconds. Supports slow motion and pause, and converts DOM
 * event timestamps (same timeline as performance.now) into game time so swing
 * timing is exact regardless of frame rate.
 */
export class GameClock {
  private realAnchor = performance.now();
  private gameAnchor = 0;
  private scale = 1;

  now(): number {
    return this.fromReal(performance.now());
  }

  fromReal(realMs: number): number {
    return this.gameAnchor + (realMs - this.realAnchor) * this.scale;
  }

  get timeScale(): number {
    return this.scale;
  }

  setTimeScale(scale: number): void {
    const real = performance.now();
    this.gameAnchor = this.fromReal(real);
    this.realAnchor = real;
    this.scale = scale;
  }
}
