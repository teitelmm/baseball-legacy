import { DIFFICULTIES, type Difficulty, type DifficultyName } from '../core/constants';
import { Rng } from '../core/rng';
import { tuning } from '../core/tuning';
import type { Batter, FieldingRatings, Handedness, Pitcher, PitchTypeId, TeamColors } from '../core/types';
import { FIELD_POSITIONS } from '../core/types';
import { applyPitch, newGameState, type GameState, type PitchEvent, type PitchOutcome } from '../sim/atBat';
import type { BattedBallPath } from '../sim/battedBall';
import { isFoul } from '../sim/outcome';
import { PITCH_ORDER } from '../sim/pitchTypes';
import type { PlaySetup } from '../sim/playSim';
import { CPU_TEAM_STYLES, USER_TEAM_STYLE } from '../sim/team';
import type { Hud } from '../ui/hud';
import type { AtBatHost, Role } from './atBatSession';

export interface PracticeOptions {
  role: Role;
  difficulty: DifficultyName;
  /** Your batting side (batting practice) or throwing arm (pitching practice). */
  userHand: Handedness;
  /** The CPU opponent's hand. 'S' mixes it up batter to batter. */
  cpuHand: Handedness | 'S';
  seed?: number;
}

const CPU_NAMES = ['M. Alvarez', 'J. Brooks', 'T. Nakamura', 'D. Okafor', 'R. Castillo', 'K. Whitfield', 'L. Moreau', 'S. Park', 'C. Ramirez', 'B. Lindqvist'];
const AVERAGE_GLOVE: FieldingRatings = { speed: 55, arm: 55, glove: 55 };

/** Batting or pitching practice: endless innings against CPU opponents, with real fielding. */
export class PracticeHost implements AtBatHost {
  readonly role: Role;
  readonly difficulty: Difficulty;
  readonly rng: Rng;
  private st: GameState = newGameState();
  private paIndex = 0;
  private current: { id: string; batter: Batter; index: number };
  private cpuPitcher: Pitcher | null = null;
  private names = new Map<string, string>();

  constructor(readonly opts: PracticeOptions) {
    this.role = opts.role;
    this.difficulty = DIFFICULTIES[opts.difficulty];
    this.rng = new Rng(opts.seed ?? Date.now());
    if (opts.role === 'batting') {
      const rating = tuning.cpuRatingOverride || this.difficulty.cpuRating;
      const stuff = tuning.cpuRatingOverride || this.difficulty.cpuPitcherStuff;
      this.cpuPitcher = {
        name: 'CPU Pitcher',
        throws: this.cpuHand(0),
        ratings: { velocity: stuff, control: rating, movement: stuff },
        repertoire: this.repertoire(),
      };
    }
    this.current = this.makeBatter();
  }

  private cpuHand(i: number): Handedness {
    const h = this.opts.cpuHand;
    if (h === 'S') return i % 3 === 2 ? 'L' : this.rng.chance(0.35) ? 'L' : 'R';
    return h;
  }

  private repertoire(): PitchTypeId[] {
    const fastball: PitchTypeId = this.rng.chance(0.65) ? 'FF' : 'SI';
    const others = (['SL', 'CU', 'CH'] as PitchTypeId[]).filter(() => this.rng.chance(0.75));
    if (others.length < 2) others.push(...(['SL', 'CH'] as PitchTypeId[]).filter((p) => !others.includes(p)));
    return [fastball, ...others];
  }

  private makeBatter(): { id: string; batter: Batter; index: number } {
    const i = this.paIndex;
    const id = `pa-${i}`;
    if (this.role === 'batting') {
      this.names.set(id, 'You');
      return { id, index: 0, batter: { name: 'You', bats: this.opts.userHand, ratings: { ...tuning.userBatter } } };
    }
    const r = tuning.cpuRatingOverride || this.difficulty.cpuRating;
    const jitter = () => Math.max(20, Math.min(99, r + this.rng.gaussian(0, 8)));
    const name = CPU_NAMES[i % CPU_NAMES.length];
    this.names.set(id, name);
    return { id, index: i, batter: { name, bats: this.cpuHand(i), ratings: { contact: jitter(), power: jitter(), eye: jitter() } } };
  }

  batter() {
    if (this.role === 'batting') this.current.batter.ratings = { ...tuning.userBatter };
    return this.current;
  }

  pitcher(): Pitcher {
    if (this.cpuPitcher) return this.cpuPitcher;
    return { name: 'You', throws: this.opts.userHand, ratings: { ...tuning.userPitcher }, repertoire: [...PITCH_ORDER] };
  }

  state(): GameState {
    return this.st;
  }

  offense(): TeamColors {
    return this.role === 'batting' ? USER_TEAM_STYLE.colors : CPU_TEAM_STYLES[0].colors;
  }

  defense(): TeamColors {
    return this.role === 'batting' ? CPU_TEAM_STYLES[0].colors : USER_TEAM_STYLE.colors;
  }

  playSetup(path: BattedBallPath): PlaySetup {
    const fielders = {} as PlaySetup['fielders'];
    for (const pos of FIELD_POSITIONS) fielders[pos] = { id: `f-${pos}`, fielding: AVERAGE_GLOVE };
    const st = this.st.outs >= 3 ? newGameState() : this.st;
    const runner = (id: string | null) => (id ? { id, speed: 50 } : null);
    return {
      path,
      foul: isFoul(path),
      fielders,
      batter: { id: this.current.id, speed: 55 },
      runners: [runner(st.bases[0]), runner(st.bases[1]), runner(st.bases[2])],
      outs: st.outs,
    };
  }

  apply(ev: PitchEvent): PitchOutcome {
    const out = applyPitch(this.st, ev, this.current.id);
    this.st = out.state;
    return out;
  }

  nameOf(id: string): string {
    return this.names.get(id) ?? '';
  }

  refreshHud(hud: Hud): void {
    const s = this.st;
    const display =
      s.outs >= 3
        ? { ...s, outs: 0, bases: [null, null, null] as GameState['bases'], count: { balls: 0, strikes: 0 }, inning: s.inning + 1 }
        : s;
    hud.update(display, this.role);
    const p = this.pitcher();
    hud.setMatchup(
      `${p.name} <span class="lbl">${p.throws === 'R' ? 'RHP' : 'LHP'}</span>`,
      `${this.current.batter.name} <span class="lbl">BATS ${this.current.batter.bats}</span>`,
    );
  }

  afterPitch(paEnded: boolean): boolean {
    if (paEnded) {
      this.paIndex++;
      this.current = this.makeBatter();
    }
    if (this.st.outs >= 3) {
      // Next inning: clear the bases now so the runners disappear.
      this.st = { ...this.st, inning: this.st.inning + 1, outs: 0, bases: [null, null, null] };
    }
    return true;
  }
}
