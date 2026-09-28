import * as THREE from 'three';
import { DIFFICULTIES, type Difficulty, type DifficultyName } from '../core/constants';
import { Rng } from '../core/rng';
import { tuning } from '../core/tuning';
import type { Pitcher, Team, TeamColors } from '../core/types';
import type { GameState, PitchEvent, PitchOutcome } from '../sim/atBat';
import type { BattedBallPath } from '../sim/battedBall';
import { Game, type UserMoment } from '../sim/gameSim';
import type { PlaySetup } from '../sim/playSim';
import { displayName, finalRatings, hittingSpot, isPitcher, isTwoWay, type PlayerProfile } from '../sim/profile';
import { CPU_TEAM_STYLES, makeTeam, makeUserTeam, type UserRole } from '../sim/team';
import { FieldActors, profileLook } from '../scene/actors';
import type { Appearance } from '../scene/humanoid';
import { BallView } from '../scene/ballView';
import { GameScreens, type MomentKind } from '../ui/gameScreens';
import type { Hud } from '../ui/hud';
import { AtBatSession, type AtBatHost, type Role, type SessionDeps } from './atBatSession';
import { LivePlay } from './livePlay';

export interface GameSetupOptions {
  profile: PlayerProfile;
  /** Two-way players: pitch (and bat) today, or play the field. Others follow their position. */
  today: 'pitch' | 'field';
  difficulty: DifficultyName;
  innings: number;
  /** Your team bats second. */
  home: boolean;
  seed?: number;
}

/** Bridges the game engine to the live at-bat view for your at-bats and your innings on the mound. */
class GameHost implements AtBatHost {
  constructor(
    private readonly gs: GameSession,
    readonly role: Role,
  ) {}

  get difficulty(): Difficulty {
    return this.gs.difficulty;
  }

  get rng(): Rng {
    return this.gs.rng;
  }

  private get g(): Game {
    return this.gs.game;
  }

  batter() {
    const p = this.g.batter;
    return { id: p.id, batter: this.g.batterForSim(p), index: this.g.lineupIdx[this.g.battingSide] };
  }

  pitcher(): Pitcher {
    return this.g.pitcherForSim();
  }

  state(): GameState {
    return this.g.state;
  }

  offense(): TeamColors {
    return this.g.battingTeam.colors;
  }

  defense(): TeamColors {
    return this.g.fieldingTeam.colors;
  }

  playSetup(path: BattedBallPath): PlaySetup {
    return this.g.playSetup(path);
  }

  apply(ev: PitchEvent, pitchMph: number): PitchOutcome {
    return this.g.applyPitch(ev, pitchMph);
  }

  refreshHud(hud: Hud): void {
    this.gs.refreshHud();
    const p = this.g.currentPitcher;
    const b = this.g.batter;
    hud.setMatchup(`${p.name} <span class="lbl">${p.throws}HP</span>`, `${b.name} <span class="lbl">BATS ${b.bats}</span>`);
  }

  nameOf(id: string): string {
    return this.gs.nameOf(id);
  }

  batterLook(): Partial<Appearance> | null {
    return this.gs.lookFor(this.g.batter.id);
  }

  pitcherLook(): Partial<Appearance> | null {
    return this.gs.lookFor(this.g.currentPitcher.id);
  }

  afterPitch(paEnded: boolean): boolean {
    if (this.g.over) return false;
    if (this.role === 'batting') return !paEnded;
    return this.g.userPitching();
  }
}

/** A full game where you play your moments and the rest is simulated. */
export class GameSession {
  readonly difficulty: Difficulty;
  readonly rng: Rng;
  game!: Game;
  private userTeam!: Team;
  private userId = '';
  private atBat: AtBatSession | null = null;
  private fielding: { play: LivePlay; actors: FieldActors; ball: BallView; exitVelo: number; mph: number } | null = null;
  private screens: GameScreens;
  private momentKind: MomentKind | null = null;
  finished = false;
  /** Test hook: play every moment automatically. */
  auto = false;
  private autoTimer = 0;

  constructor(
    readonly opts: GameSetupOptions,
    private readonly deps: SessionDeps & { uiRoot: HTMLElement },
    private readonly onMenu: () => void,
    private readonly onAgain: () => void,
  ) {
    this.difficulty = DIFFICULTIES[opts.difficulty];
    this.rng = new Rng(opts.seed ?? Date.now());
    this.screens = new GameScreens(deps.uiRoot);
    this.newGame();
  }

  private newGame(): void {
    const d = this.difficulty;
    const cpuRating = tuning.cpuRatingOverride || d.cpuRating;
    const p = this.opts.profile;
    const r = finalRatings(p);
    const { team, userId } = makeUserTeam(this.rng, 62, {
      name: displayName(p),
      number: p.number,
      role: this.todayRole,
      alsoBats: this.todayRole === 'P' && isTwoWay(p),
      bats: p.bats,
      throws: p.throws,
      // The tuning panel starts from your ratings and can override them for testing.
      batting: { ...tuning.userBatter },
      fielding: r.fielding,
      pitching: { ...tuning.userPitcher, stamina: r.pitching.stamina },
    });
    const cpu = makeTeam({ id: 'cpu', rng: this.rng, rating: cpuRating, style: this.rng.pick(CPU_TEAM_STYLES) });
    // Opposing pitchers' stuff follows the difficulty (slower, flatter on Rookie).
    for (const id of cpu.pitchers) {
      const p = cpu.players[id].pitching!;
      p.velocity = Math.round(Math.max(10, d.cpuPitcherStuff + this.rng.gaussian(0, 6)));
      p.movement = Math.round(Math.max(10, d.cpuPitcherStuff + this.rng.gaussian(0, 6)));
    }
    this.userTeam = team;
    this.userId = userId;
    this.game = new Game({
      home: this.opts.home ? team : cpu,
      away: this.opts.home ? cpu : team,
      innings: this.opts.innings,
      rng: this.rng,
      userId,
    });
    this.deps.hud.show();
    this.deps.hud.clearFeedback();
    this.advance();
  }

  /** Where you play today. */
  get todayRole(): UserRole {
    const p = this.opts.profile;
    if (this.opts.today === 'pitch' && isPitcher(p)) return 'P';
    return hittingSpot(p) ?? 'P';
  }

  get todayLabel(): string {
    return this.todayRole === 'P' && isTwoWay(this.opts.profile) ? 'P/DH' : this.todayRole;
  }

  /** Your look, for a player id (null for everyone else). */
  lookFor(id: string): Partial<Appearance> | null {
    return id === this.userId ? profileLook(this.opts.profile) : null;
  }

  nameOf(id: string): string {
    return this.game.home.players[id]?.name ?? this.game.away.players[id]?.name ?? '';
  }

  refreshHud(): void {
    const g = this.game;
    const st = g.state.outs >= 3 ? { ...g.state, outs: 0, bases: [null, null, null] as GameState['bases'], count: { balls: 0, strikes: 0 } } : g.state;
    const you = this.userTeam.players[this.userId];
    const pitching = g.userPitching();
    this.deps.hud.updateGame({
      awayAbbr: g.away.abbr,
      homeAbbr: g.home.abbr,
      awayRuns: g.score.away,
      homeRuns: g.score.home,
      inning: g.inning,
      half: g.half,
      outs: st.outs,
      count: st.count,
      bases: st.bases,
      userName: you.name,
      userPos: this.todayLabel,
      userLine: g.userLine(),
      stamina: pitching ? g.stamina() : null,
      pitches: pitching ? g.pitchCount() : 0,
    });
    this.deps.hud.setLog([]);
    if (!g.over) {
      const p = g.currentPitcher;
      const b = g.batter;
      this.deps.hud.setMatchup(`${p.name} <span class="lbl">${p.throws}HP</span>`, `${b.name} <span class="lbl">BATS ${b.bats}</span>`);
    }
  }

  /** Simulate to your next moment and show the recap. */
  private advance(): void {
    const g = this.game;
    const moment = g.nextUserMoment();
    const log = g.drainLog();
    this.refreshHud();
    if (moment.kind === 'final') {
      this.showFinal();
      return;
    }
    this.momentKind = moment.kind;
    this.deps.hud.hint('');
    this.screens.showRecap(
      g,
      log,
      moment.kind,
      g.userLine(),
      () => this.startMoment(moment),
      () => this.simToEnd(),
    );
  }

  private startMoment(m: UserMoment): void {
    const deps = this.deps;
    if (m.kind === 'bat' || m.kind === 'pitch') {
      this.atBat = new AtBatSession(new GameHost(this, m.kind === 'bat' ? 'batting' : 'pitching'), deps);
      this.atBat.auto = this.auto;
      return;
    }
    if (m.kind === 'field') {
      const g = this.game;
      const actors = new FieldActors(deps.scene, g.battingTeam.colors, g.fieldingTeam.colors);
      actors.setPitcherHand(g.currentPitcher.throws);
      actors.setBatter(g.batter.bats);
      const userPos = g.userFieldPosition();
      if (userPos) actors.setFielderLook(userPos, profileLook(this.opts.profile));
      actors.setBaseRunners(g.state.bases);
      const ball = new BallView(deps.scene);
      ball.setCamera(deps.cam.camera);
      const play = new LivePlay(
        m.setup,
        { scene: deps.scene, actors, ball, cam: deps.cam, input: deps.input, hud: deps.hud, sfx: deps.sfx, nameOf: (id) => this.nameOf(id) },
        g.userFieldPosition(),
      );
      play.autoField = this.auto;
      deps.sfx.batCrack(Math.min(1, m.exitVeloMph / 110));
      this.fielding = { play, actors, ball, exitVelo: m.exitVeloMph, mph: m.pitch.spec.speedMph };
    }
  }

  private endFielding(): void {
    const f = this.fielding!;
    const o = f.play.outcome!;
    const g = this.game;
    const batter = g.batter.name;
    g.applyPlay(o, f.exitVelo, f.mph);
    const text = o.kind === 'foul' ? 'Foul ball' : `${batter} ${o.description}`;
    const good = o.kind === 'play' && (o.batterResult === 'out' || o.batterResult === 'fc');
    this.deps.hud.feedback(text, '', good ? 'good' : 'neutral', 2600);
    f.play.dispose();
    f.actors.dispose(this.deps.scene);
    f.ball.hide();
    this.deps.scene.remove(f.ball.mesh, f.ball.shadow);
    this.fielding = null;
    this.advance();
  }

  private showFinal(): void {
    this.finished = true;
    this.momentKind = null;
    this.deps.hud.hint('');
    this.refreshHud();
    this.screens.showBoxScore(this.game, this.userId, this.onAgain, this.onMenu);
  }

  /** Simulate the rest of the game (from the recap or the pause menu). */
  simToEnd(): void {
    this.disposeLive();
    this.game.simToEnd();
    this.game.drainLog();
    this.screens.hide();
    this.showFinal();
  }

  private disposeLive(): void {
    if (this.atBat) {
      this.atBat.dispose();
      this.atBat = null;
    }
    if (this.fielding) {
      this.fielding.play.dispose();
      this.fielding.actors.dispose(this.deps.scene);
      this.fielding.ball.hide();
      this.fielding = null;
    }
  }

  refreshTuning(): void {
    this.atBat?.refreshTuning();
  }

  setAuto(v: boolean, lateMs = 0): void {
    this.auto = v;
    if (this.atBat) {
      this.atBat.auto = v;
      this.atBat.autoTimingMs = lateMs;
    }
    if (this.fielding) this.fielding.play.autoField = v;
  }

  update(now: number, dt: number): void {
    if (this.atBat) {
      this.atBat.update(now, dt);
      if (this.atBat.finished) {
        this.atBat.dispose();
        this.atBat = null;
        this.advance();
      }
      return;
    }
    if (this.fielding) {
      this.fielding.play.update(dt);
      this.deps.cam.update(dt);
      if (this.fielding.play.done) this.endFielding();
      return;
    }
    // Behind the recap / box score: a slow flyover of the field.
    const a = now / 14000;
    const cam = this.deps.cam.camera;
    cam.position.set(Math.sin(a) * 170, 75, Math.cos(a) * 170 - 90);
    cam.fov = 45;
    cam.updateProjectionMatrix();
    cam.lookAt(new THREE.Vector3(0, 0, -90));
    if (this.auto && this.screens.visible && !this.finished) {
      this.autoTimer += dt;
      if (this.autoTimer > 0.4) {
        this.autoTimer = 0;
        document.querySelector<HTMLButtonElement>('.game-screen [data-a=play]')?.click();
      }
    }
  }

  snapshot() {
    const g = this.game;
    const boxRuns = (side: 'away' | 'home') => Object.values(g.box[side].batting).reduce((a, l) => a + l.r, 0);
    return {
      mode: 'game',
      moment: this.atBat ? (this.atBat.snapshot().role === 'batting' ? 'bat' : 'pitch') : this.fielding ? 'field' : this.finished ? 'final' : 'recap',
      phase: this.atBat?.phase ?? null,
      inning: g.inning,
      half: g.half,
      score: { ...g.score },
      boxRuns: { away: boxRuns('away'), home: boxRuns('home') },
      over: g.over,
      userLine: g.userLine(),
      momentKind: this.momentKind,
    };
  }

  dispose(): void {
    this.disposeLive();
    this.screens.dispose();
    this.deps.hud.hide();
  }
}
