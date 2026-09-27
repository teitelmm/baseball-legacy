import type { Rng } from '../core/rng';
import type { Batter, FieldPosition, Pitcher, Player, Team } from '../core/types';
import { FIELD_POSITIONS } from '../core/types';
import { applyPitch, newGameState, type GameState, type PitchEvent, type PitchOutcome } from './atBat';
import { decideCpuSwing } from './ai/cpuBatter';
import { planCpuPitch } from './ai/cpuPitcher';
import { simulateBattedBall, type BattedBallPath } from './battedBall';
import { isFoul } from './outcome';
import { buildPitch, type PitchTrajectory } from './pitchPhysics';
import { PlaySim, type PlayOutcome, type PlaySetup } from './playSim';
import { evaluateSwing } from './swing';
import { isStrike } from './zone';

export type Half = 'top' | 'bottom';

export interface BatLine {
  id: string;
  name: string;
  pos: string;
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

export interface PitchLine {
  id: string;
  name: string;
  outs: number;
  h: number;
  r: number;
  bb: number;
  k: number;
  hr: number;
  pitches: number;
  strikes: number;
}

export interface TeamBox {
  batting: Record<string, BatLine>;
  order: string[];
  pitching: Record<string, PitchLine>;
  pitchersUsed: string[];
}

export interface LogEntry {
  inning: number;
  half: Half;
  text: string;
  /** Scoring play. */
  runs: number;
}

export interface GameOptions {
  home: Team;
  away: Team;
  innings: number;
  rng: Rng;
  /** Your player's id (if you're in the game). */
  userId?: string;
}

export type UserMoment =
  | { kind: 'bat' }
  | { kind: 'pitch' }
  | { kind: 'field'; setup: PlaySetup; exitVeloMph: number; pitch: PitchTrajectory }
  | { kind: 'final' };

/** Pitches a pitcher can throw before he's tired. */
export function pitchLimit(stamina: number): number {
  return Math.round(stamina * 1.25);
}

const OUTFIELD_ROLES: FieldPosition[] = ['LF', 'CF', 'RF'];

/** A full game. The same object is driven by headless simulation and by live 3D moments. */
export class Game {
  readonly home: Team;
  readonly away: Team;
  readonly innings: number;
  readonly userId: string | null;
  private rng: Rng;

  inning = 1;
  half: Half = 'top';
  state: GameState = newGameState();
  score = { away: 0, home: 0 };
  lineScore: { away: number[]; home: number[] } = { away: [], home: [] };
  lineupIdx = { away: 0, home: 0 };
  pitcher: { away: string; home: string };
  private bullpenIdx = { away: 1, home: 1 };
  box: { away: TeamBox; home: TeamBox };
  over = false;
  private log: LogEntry[] = [];
  private prevMph: number | null = null;
  /** You were taken out of the game (pitchers). */
  userPulled = false;

  constructor(o: GameOptions) {
    this.home = o.home;
    this.away = o.away;
    this.innings = o.innings;
    this.rng = o.rng;
    this.userId = o.userId ?? null;
    this.pitcher = { away: o.away.pitchers[0], home: o.home.pitchers[0] };
    this.box = { away: this.newBox(o.away), home: this.newBox(o.home) };
    this.lineScore.away.push(0);
  }

  private newBox(t: Team): TeamBox {
    const batting: Record<string, BatLine> = {};
    for (const id of t.lineup) {
      const p = t.players[id];
      batting[id] = { id, name: p.name, pos: this.positionOf(t, id), ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, k: 0 };
    }
    const sp = t.players[t.pitchers[0]];
    return {
      batting,
      order: [...t.lineup],
      pitching: { [sp.id]: this.newPitchLine(sp) },
      pitchersUsed: [sp.id],
    };
  }

  private newPitchLine(p: Player): PitchLine {
    return { id: p.id, name: p.name, outs: 0, h: 0, r: 0, bb: 0, k: 0, hr: 0, pitches: 0, strikes: 0 };
  }

  positionOf(t: Team, id: string): string {
    for (const [pos, pid] of Object.entries(t.defense)) if (pid === id) return pos;
    return t.players[id]?.pos ?? 'DH';
  }

  // -------------------------------------------------------------------------
  // Who's who

  get battingSide(): 'away' | 'home' {
    return this.half === 'top' ? 'away' : 'home';
  }

  get fieldingSide(): 'away' | 'home' {
    return this.half === 'top' ? 'home' : 'away';
  }

  get battingTeam(): Team {
    return this[this.battingSide];
  }

  get fieldingTeam(): Team {
    return this[this.fieldingSide];
  }

  get batter(): Player {
    const t = this.battingTeam;
    return t.players[t.lineup[this.lineupIdx[this.battingSide] % 9]];
  }

  get currentPitcher(): Player {
    return this.fieldingTeam.players[this.pitcher[this.fieldingSide]];
  }

  pitchCount(id = this.pitcher[this.fieldingSide]): number {
    return this.box[this.fieldingSide].pitching[id]?.pitches ?? 0;
  }

  /** 0..1, how much the current pitcher has left. */
  stamina(): number {
    const p = this.currentPitcher;
    const limit = pitchLimit(p.pitching?.stamina ?? 50);
    return Math.max(0, 1 - this.pitchCount() / limit);
  }

  /** Pitcher ratings adjusted for fatigue. */
  pitcherForSim(): Pitcher {
    const p = this.currentPitcher;
    const r = p.pitching ?? { velocity: 50, control: 50, movement: 50, stamina: 50 };
    const over = this.pitchCount() - pitchLimit(r.stamina) * 0.85;
    const tired = Math.max(0, over);
    return {
      name: p.name,
      throws: p.throws,
      ratings: {
        velocity: Math.max(5, r.velocity - tired * 0.3),
        control: Math.max(5, r.control - tired * 0.9),
        movement: Math.max(5, r.movement - tired * 0.3),
      },
      repertoire: p.repertoire ?? ['FF', 'SL', 'CH'],
    };
  }

  batterForSim(p: Player = this.batter): Batter {
    return { name: p.name, bats: p.bats, ratings: p.batting };
  }

  /** The defense for a play, with the current pitcher on the mound. */
  playFielders(): PlaySetup['fielders'] {
    const t = this.fieldingTeam;
    const out = {} as PlaySetup['fielders'];
    for (const pos of FIELD_POSITIONS) {
      const id = pos === 'P' ? this.pitcher[this.fieldingSide] : t.defense[pos];
      out[pos] = { id, fielding: t.players[id].fielding };
    }
    return out;
  }

  playSetup(path: BattedBallPath): PlaySetup {
    const bt = this.battingTeam;
    const speed = (id: string | null) => (id ? { id, speed: bt.players[id].fielding.speed } : null);
    return {
      path,
      foul: isFoul(path),
      fielders: this.playFielders(),
      batter: { id: this.batter.id, speed: this.batter.fielding.speed },
      runners: [speed(this.state.bases[0]), speed(this.state.bases[1]), speed(this.state.bases[2])],
      outs: this.state.outs,
    };
  }

  /** Your team, and your role on the current play. */
  userBatting(): boolean {
    return !this.over && this.batter.id === this.userId;
  }

  userPitching(): boolean {
    return !this.over && this.pitcher[this.fieldingSide] === this.userId;
  }

  /** Your outfield position if your team is in the field. */
  userFieldPosition(): FieldPosition | null {
    if (!this.userId || this.over) return null;
    const d = this.fieldingTeam.defense;
    for (const pos of OUTFIELD_ROLES) if (d[pos as Exclude<FieldPosition, 'P'>] === this.userId) return pos;
    return null;
  }

  // -------------------------------------------------------------------------
  // Applying pitches (shared by headless and live play)

  applyPitch(ev: PitchEvent, pitchMph: number): PitchOutcome {
    const batter = this.batter;
    const pitcherId = this.pitcher[this.fieldingSide];
    const bSide = this.battingSide;
    const fSide = this.fieldingSide;
    const outsBefore = this.state.outs >= 3 ? 0 : this.state.outs;
    const out = applyPitch(this.state, ev, batter.id);
    this.state = out.state;
    this.prevMph = pitchMph;

    const pl = this.box[fSide].pitching[pitcherId];
    pl.pitches += 1;
    if (ev.type !== 'ball') pl.strikes += 1;
    const bl = this.box[bSide].batting[batter.id];

    const runs = out.scorers.length;
    if (runs) {
      this.score[bSide] += runs;
      const ls = this.lineScore[bSide];
      ls[ls.length - 1] += runs;
      pl.r += runs;
      for (const id of out.scorers) {
        const line = this.box[bSide].batting[id];
        if (line) line.r += 1;
      }
    }

    if (out.pa) {
      const pa = out.pa;
      const isHit = pa === 'single' || pa === 'double' || pa === 'triple' || pa === 'homeRun';
      const sacFly = ev.type === 'inPlay' && ev.play.sacFly;
      const dp = ev.type === 'inPlay' && ev.play.doublePlay;
      if (pa !== 'walk' && !sacFly) bl.ab += 1;
      if (isHit) {
        bl.h += 1;
        pl.h += 1;
      }
      if (pa === 'double') bl.doubles += 1;
      if (pa === 'triple') bl.triples += 1;
      if (pa === 'homeRun') {
        bl.hr += 1;
        pl.hr += 1;
      }
      if (pa === 'walk') {
        bl.bb += 1;
        pl.bb += 1;
      }
      if (pa === 'strikeout') {
        bl.k += 1;
        pl.k += 1;
      }
      if (!dp) bl.rbi += runs;

      let text: string;
      if (pa === 'strikeout') text = ev.type === 'calledStrike' ? 'strikes out looking' : 'strikes out swinging';
      else if (pa === 'walk') text = 'walks';
      else text = ev.type === 'inPlay' ? ev.play.description : pa;
      if (runs) text += runs === 1 ? ` — ${this.nameOf(bSide, out.scorers[0])} scores` : ` — ${runs} runs score`;
      this.log.push({ inning: this.inning, half: this.half, text: `${batter.name} ${text}.`, runs });
      this.lineupIdx[bSide] += 1;
    }

    pl.outs += out.state.outs - outsBefore;

    if (this.isWalkOff()) {
      this.endGame();
      return out;
    }
    if (out.inningOver) this.endHalf();
    else if (out.pa) this.manager();
    return out;
  }

  private nameOf(side: 'away' | 'home', id: string): string {
    return this[side].players[id]?.name ?? 'runner';
  }

  private isWalkOff(): boolean {
    return this.half === 'bottom' && this.inning >= this.innings && this.score.home > this.score.away;
  }

  private endHalf(): void {
    const msg = `End of the ${this.half} of the ${ordinal(this.inning)}: ${this.away.abbr} ${this.score.away}, ${this.home.abbr} ${this.score.home}.`;
    this.log.push({ inning: this.inning, half: this.half, text: msg, runs: 0 });
    if (this.half === 'top') {
      if (this.inning >= this.innings && this.score.home > this.score.away) {
        this.lineScore.home.push(NaN); // bottom half not needed ("x")
        this.endGame();
        return;
      }
      this.half = 'bottom';
      this.lineScore.home.push(0);
    } else {
      if (this.inning >= this.innings && this.score.home !== this.score.away) {
        this.endGame();
        return;
      }
      this.half = 'top';
      this.inning += 1;
      this.lineScore.away.push(0);
    }
    this.state = { ...newGameState(), batting: this.state.batting, pitching: this.state.pitching };
    this.prevMph = null;
    this.manager();
  }

  private endGame(): void {
    this.over = true;
    const w = this.score.home > this.score.away ? this.home : this.away;
    this.log.push({ inning: this.inning, half: this.half, text: `Final: ${this.away.abbr} ${this.score.away}, ${this.home.abbr} ${this.score.home}. ${w.name} win.`, runs: 0 });
  }

  /** Manager AI: go to the bullpen when the pitcher is spent or getting hit hard. */
  private manager(): void {
    const side = this.fieldingSide;
    const team = this[side];
    const id = this.pitcher[side];
    const p = team.players[id];
    const line = this.box[side].pitching[id];
    const limit = pitchLimit(p.pitching?.stamina ?? 50);
    const starter = team.pitchers[0] === id;
    const tooMany = line.pitches >= limit;
    const shelled = line.r >= (starter ? 6 : 4) && line.pitches > 20;
    if (!tooMany && !shelled) return;
    const next = team.pitchers[this.bullpenIdx[side]];
    if (!next) return;
    this.bullpenIdx[side] += 1;
    this.pitcher[side] = next;
    const np = team.players[next];
    if (!this.box[side].pitching[next]) {
      this.box[side].pitching[next] = this.newPitchLine(np);
      this.box[side].pitchersUsed.push(next);
    }
    if (id === this.userId) this.userPulled = true;
    this.log.push({ inning: this.inning, half: this.half, text: `Pitching change: ${np.name} replaces ${p.name}.`, runs: 0 });
  }

  // -------------------------------------------------------------------------
  // Headless simulation

  /** Plan and throw one CPU pitch; returns the trajectory and the CPU batter's reaction. */
  private simPitchParts() {
    const pitcher = this.pitcherForSim();
    const batter = this.batterForSim();
    const plan = planCpuPitch(pitcher, this.state.count, batter.bats, this.rng);
    const traj = buildPitch(plan.spec);
    const decision = decideCpuSwing(batter, traj, this.state.count, this.prevMph, this.rng);
    return { traj, decision, batter };
  }

  /**
   * Simulate one pitch. If the ball is put in play toward your outfield position,
   * stops before the play and returns it as a fielding moment.
   */
  simPitch(stopForUserFielding = false): UserMoment | null {
    const { traj, decision, batter } = this.simPitchParts();
    const mph = traj.spec.speedMph;
    if (!decision.swing || !decision.input) {
      this.applyPitch({ type: isStrike(traj.spec.plateLoc) ? 'calledStrike' : 'ball' }, mph);
      return null;
    }
    const r = evaluateSwing(
      decision.input,
      {
        ballLoc: traj.spec.plateLoc,
        pitchSpeedMph: mph,
        bats: batter.bats,
        contactRating: batter.ratings.contact,
        powerRating: batter.ratings.power,
        params: { timingScale: 1, pciScale: 1 },
      },
      this.rng,
    );
    if (r.kind === 'whiff') {
      this.applyPitch({ type: 'swingingStrike' }, mph);
      return null;
    }
    if (r.kind === 'foulTip') {
      this.applyPitch({ type: 'foul' }, mph);
      return null;
    }
    const path = simulateBattedBall({
      exitVeloMph: r.exitVeloMph,
      launchAngleDeg: r.launchAngleDeg,
      sprayDeg: r.sprayDeg,
      start: { x: traj.spec.plateLoc.x, y: traj.spec.plateLoc.y, z: -0.3 },
    });
    const setup = this.playSetup(path);
    const userPos = stopForUserFielding ? this.userFieldPosition() : null;
    if (userPos && !setup.foul && !path.homeRun) {
      const probe = new PlaySim(setup);
      if (probe.primary === userPos) return { kind: 'field', setup, exitVeloMph: r.exitVeloMph, pitch: traj };
    }
    this.applyPlay(new PlaySim(setup).run(), r.exitVeloMph, mph);
    return null;
  }

  /** Apply the result of a ball in play (headless or live). */
  applyPlay(outcome: PlayOutcome, exitVeloMph: number, pitchMph: number): PitchOutcome {
    if (outcome.kind === 'foul') return this.applyPitch({ type: 'foul' }, pitchMph);
    return this.applyPitch({ type: 'inPlay', play: outcome, exitVeloMph }, pitchMph);
  }

  /** Simulate until it's your turn to play (or the game ends). */
  nextUserMoment(): UserMoment {
    let guard = 0;
    while (!this.over && guard++ < 5000) {
      if (this.userBatting()) return { kind: 'bat' };
      if (this.userPitching()) return { kind: 'pitch' };
      const m = this.simPitch(true);
      if (m) return m;
    }
    return { kind: 'final' };
  }

  /** Simulate the rest of the game. */
  simToEnd(): void {
    let guard = 0;
    while (!this.over && guard++ < 10000) this.simPitch(false);
  }

  drainLog(): LogEntry[] {
    const l = this.log;
    this.log = [];
    return l;
  }

  /** Your line so far, e.g. "1-3, 2B, RBI" or "4.1 IP, 2 R, 5 K". */
  userLine(): string {
    if (!this.userId) return '';
    for (const side of ['away', 'home'] as const) {
      const pl = this.box[side].pitching[this.userId];
      if (pl) return `${Math.floor(pl.outs / 3)}.${pl.outs % 3} IP, ${pl.h} H, ${pl.r} R, ${pl.bb} BB, ${pl.k} K`;
      const bl = this.box[side].batting[this.userId];
      if (bl) {
        const parts = [`${bl.h}-${bl.ab}`];
        if (bl.doubles) parts.push(bl.doubles > 1 ? `${bl.doubles} 2B` : '2B');
        if (bl.triples) parts.push('3B');
        if (bl.hr) parts.push(bl.hr > 1 ? `${bl.hr} HR` : 'HR');
        if (bl.rbi) parts.push(bl.rbi > 1 ? `${bl.rbi} RBI` : 'RBI');
        if (bl.bb) parts.push(bl.bb > 1 ? `${bl.bb} BB` : 'BB');
        if (bl.k) parts.push(bl.k > 1 ? `${bl.k} K` : 'K');
        return parts.join(', ');
      }
    }
    return '';
  }
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
