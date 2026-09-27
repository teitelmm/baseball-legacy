/** Tiny synthesized sound effects (no audio files). */
export class Sfx {
  private ctx: AudioContext | null = null;
  enabled = true;

  /** Must be called from a user gesture before sounds can play. */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        this.ctx = null;
      }
    }
    void this.ctx?.resume();
  }

  private noise(duration: number): AudioBufferSourceNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return null;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  private envelope(peak: number, attack: number, decay: number): GainNode | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(ctx.destination);
    return g;
  }

  /** Crack of the bat; quality 0..1 makes it sharper and louder. */
  batCrack(quality: number): void {
    const ctx = this.ctx;
    const src = this.noise(0.25);
    const env = this.envelope(0.25 + quality * 0.6, 0.002, 0.08 + quality * 0.1);
    if (!ctx || !src || !env) return;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400 + quality * 1800;
    bp.Q.value = 1.2;
    src.connect(bp).connect(env);
    src.start();
    const osc = ctx.createOscillator();
    const oenv = this.envelope(0.2 * quality, 0.001, 0.06);
    if (!oenv) return;
    osc.frequency.value = 520 + quality * 300;
    osc.connect(oenv);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  }

  mittPop(speed: number): void {
    const ctx = this.ctx;
    const src = this.noise(0.12);
    const env = this.envelope(0.2 + Math.min(0.5, (speed - 70) / 60), 0.001, 0.07);
    if (!ctx || !src || !env) return;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    src.connect(lp).connect(env);
    src.start();
  }

  whoosh(): void {
    const ctx = this.ctx;
    const src = this.noise(0.3);
    const env = this.envelope(0.12, 0.08, 0.18);
    if (!ctx || !src || !env) return;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(400, ctx.currentTime);
    bp.frequency.linearRampToValueAtTime(1600, ctx.currentTime + 0.25);
    src.connect(bp).connect(env);
    src.start();
  }

  crowd(intensity: number, duration = 2.5): void {
    const ctx = this.ctx;
    const src = this.noise(duration);
    if (!ctx || !src) return;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08 + intensity * 0.25, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    g.connect(ctx.destination);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.4;
    src.connect(bp).connect(g);
    src.start();
  }

  click(): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const osc = ctx.createOscillator();
    const env = this.envelope(0.06, 0.001, 0.04);
    if (!env) return;
    osc.frequency.value = 880;
    osc.connect(env);
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  }
}
