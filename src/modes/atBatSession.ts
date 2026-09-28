import * as THREE from 'three';
import { CATCHER_Z, INCH, SWING_TIME_MS, type Difficulty } from '../core/constants';
import type { GameClock } from '../core/clock';
import type { Input, ClickEvent } from '../core/input';
import type { Rng } from '../core/rng';
import { tuning } from '../core/tuning';
import type { Batter, Pitcher, PitchTypeId, PlateLoc, SwingType, TeamColors, Vec3 } from '../core/types';
import type { Sfx } from '../audio/sfx';
import type { GameState, PitchEvent, PitchOutcome } from '../sim/atBat';
import { decideCpuSwing } from '../sim/ai/cpuBatter';
import { planCpuPitch } from '../sim/ai/cpuPitcher';
import { simulateBattedBall, type BattedBallPath } from '../sim/battedBall';
import { effortBonusMph, missInches, PitchMeter, powerSpeedFactor } from '../sim/pitchMeter';
import { buildPitch, positionAt, timeAtZ, type PitchSpec, type PitchTrajectory } from '../sim/pitchPhysics';
import { maxVelocity, movementScale, PITCH_TYPES } from '../sim/pitchTypes';
import type { PlaySetup } from '../sim/playSim';
import { evaluateSwing, pciSize, timingWindows, type SwingParams, type SwingResult } from '../sim/swing';
import { isStrike } from '../sim/zone';
import { BATTER_STANCE, batterLoadKeys, batterSwingKeys, catcherPose, pitcherKeys, SWING_DURATION, WINDUP_DURATION } from '../scene/animations';
import { BATTER_OFFSET, CATCHER_ROOT_Z, FieldActors } from '../scene/actors';
import { BallView } from '../scene/ballView';
import type { CameraRig } from '../scene/cameraRig';
import { samplePose, type Keyframes } from '../scene/humanoid';
import { ZoneOverlay } from '../scene/zoneOverlay';
import type { Hud, PitchLogEntry } from '../ui/hud';
import { LivePlay } from './livePlay';

export type Role = 'batting' | 'pitching';
export type Phase = 'prePitch' | 'windup' | 'flight' | 'inPlay' | 'result';

/** Supplies the people and the game state for live at-bats (practice or a real game). */
export interface AtBatHost {
  /** What you're doing: batting or pitching. */
  readonly role: Role;
  readonly difficulty: Difficulty;
  readonly rng: Rng;
  batter(): { id: string; batter: Batter; index: number };
  pitcher(): Pitcher;
  state(): GameState;
  offense(): TeamColors;
  defense(): TeamColors;
  playSetup(path: BattedBallPath): PlaySetup;
  apply(ev: PitchEvent, pitchMph: number): PitchOutcome;
  refreshHud(hud: Hud): void;
  nameOf(id: string): string;
  /** Called after each pitch's result is shown. Return false when the live moment is over. */
  afterPitch(paEnded: boolean): boolean;
}

export interface SessionDeps {
  scene: THREE.Scene;
  cam: CameraRig;
  input: Input;
  clock: GameClock;
  hud: Hud;
  sfx: Sfx;
}

const PRE_PITCH_MS = 1300;
const RESULT_MS = 1400;
const IN_PLAY_RESULT_MS = 1600;

interface SwingRecord {
  at: number;
  type: SwingType;
  pci: PlateLoc;
  result: SwingResult;
  keys: Keyframes;
}

interface PitchInFlight {
  traj: PitchTrajectory;
  target: PlateLoc;
  windupAt: number;
  releaseAt: number;
  arrivalAt: number;
  catchAt: number;
  /** When a take is called: late enough that a late swing can still register. */
  callAt: number;
  /** Mitt pop already played. */
  caught: boolean;
  swing: SwingRecord | null;
  /** Set once the CPU batter has made its decision. */
  cpuDecided: boolean;
}

interface BallInPlay {
  play: LivePlay;
  exitVeloMph: number;
  contactAt: number;
}

function swingParams(d: Difficulty): SwingParams {
  return {
    timingScale: tuning.timingScaleOverride || d.timingScale,
    pciScale: tuning.pciScaleOverride || d.pciScale,
    contactAssist: tuning.contactAssistOverride >= 0 ? tuning.contactAssistOverride : d.contactAssist,
  };
}

function pitchGuideOn(d: Difficulty): boolean {
  return tuning.pitchGuide === 'auto' ? d.pitchGuide : tuning.pitchGuide === 'on';
}

/** Live pitch-by-pitch play in 3D, for practice or your moments in a game. */
export class AtBatSession {
  readonly difficulty: Difficulty;
  phase: Phase = 'prePitch';
  /** The live moment is over (the host said so after a pitch). */
  finished = false;
  private phaseAt = 0;
  private rng: Rng;

  private batterId = '';
  private batter!: Batter;
  private pitcher!: Pitcher;
  readonly actors: FieldActors;
  private ball: BallView;
  private zone: ZoneOverlay;

  private pitch: PitchInFlight | null = null;
  private inPlay: BallInPlay | null = null;
  private meter: PitchMeter | null = null;
  private selectedPitch: PitchTypeId = 'FF';
  private aim: PlateLoc = { x: 0, y: 2.5 };
  private pciLoc: PlateLoc = { x: 0, y: 2.5 };
  private prevPitchMph: number | null = null;
  private pitchLog: PitchLogEntry[] = [];
  private pendingPaEnd = false;
  private unsubs: Array<() => void> = [];
  private lastEvent = '';
  private readonly scene: THREE.Scene;
  private readonly cam: CameraRig;
  private readonly input: Input;
  private readonly clock: GameClock;
  private readonly hud: Hud;
  private readonly sfx: Sfx;
  /** Test hook: automatically swing (batting) or pitch (pitching). */
  auto = false;
  /** Test hook: how late (ms) the automatic swing is. */
  autoTimingMs = 0;
  /** Test hook: force the next ball in play (exit velo, launch angle, spray). */
  forceHit: { ev: number; la: number; spray: number } | null = null;

  constructor(
    private readonly host: AtBatHost,
    deps: SessionDeps,
  ) {
    this.scene = deps.scene;
    this.cam = deps.cam;
    this.input = deps.input;
    this.clock = deps.clock;
    this.hud = deps.hud;
    this.sfx = deps.sfx;
    this.difficulty = host.difficulty;
    this.rng = host.rng;

    this.actors = new FieldActors(this.scene, host.offense(), host.defense());
    this.ball = new BallView(this.scene);
    this.ball.setCamera(this.cam.camera);
    this.zone = new ZoneOverlay(this.scene);
    this.loadMatchup(true);
    this.syncPciSize();

    this.unsubs.push(this.input.onClick((e) => this.onClick(e)));
    this.unsubs.push(this.input.onKey((e) => this.onKey(e)));

    const userIsBatting = this.isUserBatting();
    const shot = userIsBatting ? this.cam.battingShot(this.batter.bats) : this.cam.pitchingShot(this.pitcher.throws);
    this.cam.setShot(userIsBatting ? 'batting' : 'pitching', shot, true);

    this.hud.show();
    this.hud.clearFeedback();
    this.refreshHud();
    this.enterPrePitch(this.clock.now());
  }

  /** Pull the current batter and pitcher from the host (new plate appearance). */
  private loadMatchup(force = false): void {
    const b = this.host.batter();
    const p = this.host.pitcher();
    const newBatter = force || b.id !== this.batterId;
    this.batterId = b.id;
    this.batter = b.batter;
    this.pitcher = p;
    this.actors.setTeams(this.host.offense(), this.host.defense());
    this.actors.setPitcherHand(p.throws);
    if (newBatter) {
      this.actors.setBatter(b.batter.bats, b.index);
      this.prevPitchMph = null;
    }
  }

  /** Pick up rating / PCI changes from the debug panel. */
  refreshTuning(): void {
    this.loadMatchup();
    this.syncPciSize();
    if (this.phase === 'prePitch' && !this.isUserBatting() && this.meter?.phase === 'idle') this.refreshPitchMenu();
  }

  private syncPciSize(): void {
    const contact = this.isUserBatting() ? this.batter.ratings.contact : tuning.userBatter.contact;
    const s = pciSize('normal', contact, swingParams(this.difficulty));
    this.zone.setPciSize(s.outerHalfW, s.outerHalfH, s.innerHalfW, s.innerHalfH);
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.inPlay?.play.dispose();
    this.actors.dispose(this.scene);
    this.scene.remove(this.zone.group);
    this.ball.hide();
    this.scene.remove(this.ball.mesh, this.ball.shadow);
    this.hud.setMeter(null, null);
    this.hud.setPitchMenu(null, null);
    this.hud.hide();
  }

  // ---------------------------------------------------------------------------
  // Input

  private isUserBatting(): boolean {
    return this.host.role === 'batting';
  }

  private onClick(e: ClickEvent): void {
    this.sfx.unlock();
    const t = this.clock.fromReal(e.timeStamp);
    if (this.isUserBatting()) {
      if (this.phase === 'windup' || this.phase === 'flight') {
        const type: SwingType = e.button === 'secondary' || e.shift ? 'power' : 'normal';
        this.userSwing(t, type);
      } else if (this.phase === 'result') {
        this.skipResult();
      }
    } else if (this.phase === 'prePitch' && this.meter) {
      this.meter.click(t / 1000);
      this.sfx.click();
    } else if (this.phase === 'result') {
      this.skipResult();
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.isUserBatting() && this.phase === 'prePitch' && this.meter?.phase === 'idle') {
      const i = Number(e.key) - 1;
      if (i >= 0 && i < this.pitcher.repertoire.length) this.selectPitch(this.pitcher.repertoire[i]);
    }
    if (e.key === ' ' && this.phase === 'result') this.skipResult();
  }

  private selectPitch(id: PitchTypeId): void {
    if (this.meter && this.meter.phase !== 'idle') return;
    this.selectedPitch = id;
    this.sfx.click();
    this.refreshPitchMenu();
  }

  private skipResult(): void {
    if (this.clock.now() - this.phaseAt > 500) this.phaseAt = -1e9;
  }

  // ---------------------------------------------------------------------------
  // Phases

  private enterPrePitch(now: number): void {
    this.phase = 'prePitch';
    this.phaseAt = now;
    this.pitch = null;
    this.inPlay = null;
    this.ball.clearTrail();
    this.loadMatchup();
    this.actors.resetDefense();
    this.actors.batter.apply(BATTER_STANCE);
    this.actors.setBaseRunners(this.host.state().bases);
    this.syncPciSize();

    if (this.isUserBatting()) {
      this.cam.setShot('batting', this.cam.battingShot(this.batter.bats));
      this.hud.hint('<kbd>Mouse</kbd> aim PCI &nbsp; <kbd>Left-click</kbd> swing &nbsp; <kbd>Right-click / Shift+click</kbd> power swing &nbsp; <kbd>Esc</kbd> pause');
    } else {
      this.cam.setShot('pitching', this.cam.pitchingShot(this.pitcher.throws));
      this.meter = new PitchMeter(this.difficulty.meterSpeed);
      this.refreshPitchMenu();
      this.hud.hint('<kbd>1–5</kbd> pitch &nbsp; <kbd>Mouse</kbd> aim &nbsp; <kbd>Click</kbd> start → <kbd>Click</kbd> power → <kbd>Click</kbd> on the yellow line &nbsp; <kbd>Esc</kbd> pause');
    }
  }

  private refreshPitchMenu(): void {
    const maxV = maxVelocity(this.pitcher.ratings.velocity);
    this.hud.setPitchMenu(
      this.pitcher.repertoire.map((id, i) => ({
        id,
        key: String(i + 1),
        name: PITCH_TYPES[id].name,
        mph: maxV * PITCH_TYPES[id].speedFactor,
        color: PITCH_TYPES[id].color,
      })),
      this.selectedPitch,
      (id) => this.selectPitch(id as PitchTypeId),
    );
  }

  private startPitch(now: number, spec: PitchSpec, target: PlateLoc): void {
    const traj = buildPitch(spec);
    const releaseAt = now + WINDUP_DURATION * 1000;
    const arrivalAt = releaseAt + traj.flightTime * 1000;
    const catchAt = releaseAt + timeAtZ(traj, CATCHER_Z) * 1000;
    // A human batter can still swing a little after the ball passes (late contact).
    const lateGrace = this.isUserBatting()
      ? Math.max(0, timingWindows('normal', swingParams(this.difficulty)).whiff - SWING_TIME_MS + tuning.timingOffsetMs)
      : 0;
    const callAt = Math.max(catchAt, arrivalAt + lateGrace);
    this.pitch = { traj, target, windupAt: now, releaseAt, arrivalAt, catchAt, callAt, caught: false, swing: null, cpuDecided: false };
    this.phase = 'windup';
    this.phaseAt = now;
    this.hud.setPitchMenu(null, null);
    this.hud.setMeter(null, null);
    this.actors.catcher.apply(catcherPose(this.mittLocal(target, 2.4)));
  }

  private cpuPitch(now: number): void {
    const plan = planCpuPitch(this.pitcher, this.host.state().count, this.batter.bats, this.rng, this.difficulty.cpuZoneBias);
    this.startPitch(now, plan.spec, plan.target);
  }

  private userPitch(now: number): void {
    const res = this.meter!.result!;
    const def = PITCH_TYPES[this.selectedPitch];
    const r = this.pitcher.ratings;
    const miss = missInches(res, r.control, this.difficulty.pitchErrorScale) * INCH;
    // Early (above the line) misses up and to the glove side; late misses down and arm side.
    const glove = this.pitcher.throws === 'R' ? 1 : -1;
    const early = res.accuracy > 0;
    const base = early ? Math.atan2(0.75, glove * 0.65) : Math.atan2(-0.75, -glove * 0.65);
    const angle = base + this.rng.gaussian(0, 0.6);
    const plateLoc = { x: this.aim.x + Math.cos(angle) * miss, y: this.aim.y + Math.sin(angle) * miss };
    const speed = maxVelocity(r.velocity) * def.speedFactor * powerSpeedFactor(res.power) + effortBonusMph(res.power);
    const spec: PitchSpec = {
      type: this.selectedPitch,
      throws: this.pitcher.throws,
      speedMph: speed,
      plateLoc,
      breakScale: movementScale(r.movement) * (0.85 + 0.15 * Math.min(1, res.power)),
    };
    this.meter = null;
    this.startPitch(now, spec, { ...this.aim });
  }

  private userSwing(t: number, type: SwingType): void {
    const p = this.pitch;
    if (!p || p.swing) return;
    if (t > p.callAt) return;
    const timingErrorMs = t + SWING_TIME_MS - p.arrivalAt - tuning.timingOffsetMs;
    const result = evaluateSwing(
      { type, pci: { ...this.pciLoc }, timingErrorMs },
      {
        ballLoc: p.traj.spec.plateLoc,
        pitchSpeedMph: p.traj.spec.speedMph,
        bats: this.batter.bats,
        contactRating: this.batter.ratings.contact,
        powerRating: this.batter.ratings.power,
        params: swingParams(this.difficulty),
      },
      this.rng,
    );
    this.recordSwing(t, type, { ...this.pciLoc }, result);
    this.zone.flashPci();
  }

  private recordSwing(at: number, type: SwingType, pci: PlateLoc, result: SwingResult): void {
    const contactZ = BATTER_OFFSET + (this.batter.bats === 'R' ? pci.x : -pci.x);
    this.pitch!.swing = { at, type, pci, result, keys: batterSwingKeys(contactZ, pci.y) };
    this.sfx.whoosh();
  }

  private cpuDecide(): void {
    const p = this.pitch!;
    p.cpuDecided = true;
    const d = decideCpuSwing(this.batter, p.traj, this.host.state().count, this.prevPitchMph, this.rng);
    if (!d.swing || !d.input) return;
    const result = evaluateSwing(
      d.input,
      {
        ballLoc: p.traj.spec.plateLoc,
        pitchSpeedMph: p.traj.spec.speedMph,
        bats: this.batter.bats,
        contactRating: this.batter.ratings.contact,
        powerRating: this.batter.ratings.power,
        params: { timingScale: 1, pciScale: 1 },
      },
      this.rng,
    );
    const at = p.arrivalAt - SWING_TIME_MS + d.input.timingErrorMs;
    const contactZ = BATTER_OFFSET + (this.batter.bats === 'R' ? d.input.pci.x : -d.input.pci.x);
    p.swing = { at, type: d.input.type, pci: d.input.pci, result, keys: batterSwingKeys(contactZ, d.input.pci.y) };
  }

  /** The ball reaches the plate: contact, or it carries on to the catcher. */
  private resolveAtPlate(now: number): void {
    const p = this.pitch!;
    const s = p.swing;
    if (!s) return;
    const r = s.result;
    if (r.kind === 'whiff') return;
    let ev: number;
    let la: number;
    let spray: number;
    let quality: number;
    if (r.kind === 'foulTip') {
      ev = 50 + this.rng.range(0, 20);
      la = this.rng.range(30, 70);
      spray = (this.rng.chance(0.5) ? 1 : -1) * this.rng.range(150, 200);
      quality = 0.1;
    } else {
      ev = r.exitVeloMph;
      la = r.launchAngleDeg;
      spray = r.sprayDeg;
      quality = r.quality;
      if (this.forceHit) {
        ({ ev, la, spray } = this.forceHit);
        r.exitVeloMph = ev;
        r.launchAngleDeg = la;
        r.sprayDeg = spray;
        this.forceHit = null;
      }
    }
    const start: Vec3 = { x: p.traj.spec.plateLoc.x, y: p.traj.spec.plateLoc.y, z: -0.3 };
    const path = simulateBattedBall({ exitVeloMph: ev, launchAngleDeg: la, sprayDeg: spray, start });
    const setup = this.host.playSetup(path);
    if (r.kind === 'foulTip') setup.foul = true;
    const play = new LivePlay(setup, {
      scene: this.scene,
      actors: this.actors,
      ball: this.ball,
      cam: this.cam,
      input: this.input,
      hud: this.hud,
      sfx: this.sfx,
      nameOf: (id) => this.host.nameOf(id),
    });
    this.inPlay = { play, exitVeloMph: ev, contactAt: now };
    this.phase = 'inPlay';
    this.phaseAt = now;
    this.sfx.batCrack(quality);
    if (!setup.foul && ev > 95 && la > 15) this.sfx.crowd(Math.min(1, (ev - 90) / 20), 3);
  }

  private finishPitch(now: number, ev: PitchEvent, call: string): void {
    const p = this.pitch!;
    const out = this.host.apply(ev, p.traj.spec.speedMph);
    this.lastEvent = out.description;
    this.prevPitchMph = p.traj.spec.speedMph;
    const def = PITCH_TYPES[p.traj.spec.type];
    this.pitchLog.push({ n: this.pitchLog.length + 1, name: def.name, mph: p.traj.spec.speedMph, call, color: def.color });
    this.zone.addMarker(p.traj.spec.plateLoc, def.color, this.pitchLog.length);
    this.pendingPaEnd = !!out.pa;
    this.phase = 'result';
    this.phaseAt = now;
    this.refreshHud();
    this.showResultFeedback(ev, out.description, out.runsScored, out.inningOver);
  }

  private showResultFeedback(ev: PitchEvent, description: string, runs: number, inningOver: boolean): void {
    const p = this.pitch!;
    const def = PITCH_TYPES[p.traj.spec.type];
    const pitchLine = `${p.traj.spec.speedMph.toFixed(1)} mph ${def.name}`;
    const s = p.swing;
    const batting = this.isUserBatting();
    const extra = [runs ? `${runs} run${runs > 1 ? 's' : ''} score${runs > 1 ? '' : 's'}` : '', inningOver ? 'Side retired' : '']
      .filter(Boolean)
      .join(' · ');
    if (batting && s) this.hud.setTiming(s.result.timingErrorMs, timingWindows(s.type, swingParams(this.difficulty)));
    else this.hud.setTiming(null);
    const timing = (ms: number, label: string) => (tuning.showTimingMs ? `${label} (${ms > 0 ? '+' : ''}${ms.toFixed(0)} ms)` : label);

    if (ev.type === 'inPlay' && s && s.result.kind === 'contact' && this.inPlay) {
      const r = s.result;
      const bb = this.inPlay.play.sim.setup.path;
      const play = ev.play;
      const homer = play.batterResult === 'homeRun';
      const title = homer ? 'HOME RUN!' : capitalize(description);
      const detail = [
        homer ? capitalize(description) : '',
        `${timing(r.timingErrorMs, r.timingLabel)} · ${r.contactLabel}`,
        `${r.exitVeloMph.toFixed(1)} mph · ${r.launchAngleDeg.toFixed(0)}° · ${Math.round(bb.distance)} ft`,
        extra,
      ]
        .filter(Boolean)
        .join('<br>');
      const hit = ['single', 'double', 'triple', 'homeRun'].includes(play.batterResult);
      const tone = play.batterResult === 'homeRun' ? 'big' : hit === batting ? 'good' : 'bad';
      this.hud.feedback(title, detail, tone, 3000);
      return;
    }

    let detail = pitchLine;
    if (s && s.result.kind === 'whiff') {
      const r = s.result;
      if (r.reason === 'timing') {
        detail = `${timing(r.timingErrorMs, r.timingLabel)} · ${pitchLine}`;
      } else {
        const b = p.traj.spec.plateLoc;
        const dx = b.x - s.pci.x;
        const dy = b.y - s.pci.y;
        const inside = this.batter.bats === 'R' ? dx < 0 : dx > 0;
        const where = Math.abs(dy) > Math.abs(dx) ? (dy > 0 ? 'above' : 'below') : inside ? 'inside' : 'outside';
        detail = `Ball was ${where} your PCI · ${pitchLine}`;
      }
    } else if (s && s.result.kind === 'foulTip') {
      detail = `${timing(s.result.timingErrorMs, s.result.timingLabel)} · ${pitchLine}`;
    } else if (!batting && ev.type !== 'inPlay') {
      const t = p.target;
      const actual = p.traj.spec.plateLoc;
      const off = Math.hypot(actual.x - t.x, actual.y - t.y) / INCH;
      detail = `${pitchLine} · missed spot by ${off.toFixed(1)}"`;
    }
    if (extra) detail += `<br>${extra}`;
    const good =
      ev.type === 'ball' ? batting : ev.type === 'calledStrike' || ev.type === 'swingingStrike' || ev.type === 'foul' ? !batting : false;
    const tone = description.startsWith('Strike three') || description.includes('walk') ? (good ? 'good' : 'bad') : 'neutral';
    this.hud.feedback(capitalize(description), detail, tone, 2000);
  }

  private endResult(now: number): void {
    const paEnded = this.pendingPaEnd;
    if (paEnded) {
      this.pitchLog = [];
      this.zone.clearMarkers();
    }
    this.pendingPaEnd = false;
    this.inPlay?.play.dispose();
    this.inPlay = null;
    if (!this.host.afterPitch(paEnded)) {
      this.finished = true;
      return;
    }
    this.refreshHud();
    this.enterPrePitch(now);
  }

  private refreshHud(): void {
    this.host.refreshHud(this.hud);
    this.hud.setLog(this.pitchLog);
  }

  // ---------------------------------------------------------------------------
  // Frame update

  update(now: number, dt: number): void {
    this.zone.setZoneVisible(tuning.showZone);
    const guide = this.isUserBatting() && pitchGuideOn(this.difficulty);
    this.ball.showTrail = tuning.showTrail || guide;
    this.ball.boost = this.isUserBatting() && this.phase !== 'inPlay' ? 1.8 : 1;
    this.ball.setGlow(this.isUserBatting() && (this.phase === 'windup' || this.phase === 'flight'));
    this.zone.update(dt);

    // PCI / aim follow the mouse.
    const loc = this.input.plateLoc(this.cam.camera);
    const aiming = this.phase === 'prePitch' || this.phase === 'windup' || this.phase === 'flight';
    if (this.isUserBatting()) {
      const swing = this.pitch?.swing;
      if (loc && !swing) {
        // Glide toward the mouse so the PCI doesn't jitter.
        const k = 1 - Math.exp(-dt / 0.025);
        const tx = THREE.MathUtils.clamp(loc.x, -1.8, 1.8);
        const ty = THREE.MathUtils.clamp(loc.y, 0.8, 4.4);
        this.pciLoc = { x: this.pciLoc.x + (tx - this.pciLoc.x) * k, y: this.pciLoc.y + (ty - this.pciLoc.y) * k };
      }
      // After a swing the PCI freezes where it was, next to where the ball crossed.
      const snapshot = !!swing && !this.inPlay && (this.phase === 'result' || now >= (this.pitch?.arrivalAt ?? Infinity));
      this.zone.pci.visible = aiming || snapshot;
      this.zone.setPci(swing ? swing.pci : this.pciLoc);
      this.zone.setBallMark(snapshot && this.pitch ? this.pitch.traj.spec.plateLoc : null);
      const p = this.pitch;
      this.zone.setGuide(
        guide && p && this.phase === 'flight' ? p.traj.spec.plateLoc : null,
        p ? (now - p.releaseAt) / (p.arrivalAt - p.releaseAt) : 0,
      );
      this.zone.reticle.visible = false;
    } else {
      if (loc && this.phase === 'prePitch' && this.meter?.phase === 'idle') {
        this.aim = { x: THREE.MathUtils.clamp(loc.x, -2.2, 2.2), y: THREE.MathUtils.clamp(loc.y, 0.6, 4.6) };
      }
      this.zone.reticle.visible = this.phase === 'prePitch' || this.phase === 'windup';
      this.zone.setReticle(this.pitch ? this.pitch.target : this.aim);
      this.zone.pci.visible = false;
    }
    document.getElementById('game')?.classList.toggle('aiming', aiming);
    // The batting camera sits where the catcher and umpire are; hide them in that view.
    const battingCam = this.isUserBatting() && (this.cam.mode === 'batting' || !this.cam.settled);
    this.actors.catcher.root.visible = !battingCam;
    this.actors.umpire.root.visible = !battingCam;

    switch (this.phase) {
      case 'prePitch':
        this.updatePrePitch(now);
        break;
      case 'windup':
      case 'flight':
        this.updatePitch(now);
        break;
      case 'inPlay':
        this.updateInPlay(now, dt);
        break;
      case 'result': {
        const hold = this.inPlay ? IN_PLAY_RESULT_MS : RESULT_MS;
        if (this.inPlay) this.inPlay.play.update(dt);
        else this.animateSwing(now);
        if (now - this.phaseAt > hold) this.endResult(now);
        break;
      }
    }

    if (!this.inPlay) this.actors.idle(now);
    this.cam.update(dt);
  }

  private updatePrePitch(now: number): void {
    // Ball in the pitcher's hand.
    this.placeBallInHand();
    if (this.isUserBatting()) {
      if (now - this.phaseAt > PRE_PITCH_MS) this.cpuPitch(now);
      return;
    }
    const m = this.meter!;
    if (this.auto && m.phase === 'idle' && now - this.phaseAt > 300) {
      this.selectedPitch = this.rng.pick(this.pitcher.repertoire);
      this.aim = { x: this.rng.range(-0.6, 0.6), y: this.rng.range(1.8, 3.2) };
      m.click(now / 1000);
      const powerAt = now / 1000 + 0.95 / 1.15 / this.difficulty.meterSpeed;
      m.click(powerAt);
      m.click(powerAt + 0.95 / 1.5 / this.difficulty.meterSpeed + this.rng.gaussian(0, 0.02));
    }
    m.update(now / 1000);
    this.hud.setMeter(m.phase === 'idle' ? 0 : m.value(now / 1000), m.phase === 'falling' || m.phase === 'done' ? m.power : null);
    if (m.phase === 'done') this.userPitch(now);
  }

  private placeBallInHand(): void {
    const pm = this.actors.pitcher;
    const hand = pm.handPosition('R');
    pm.root.updateMatrixWorld();
    hand.applyMatrix4(pm.root.matrixWorld);
    this.ball.set(hand);
    this.ball.clearTrail();
  }

  private updatePitch(now: number): void {
    const p = this.pitch!;
    // Pitcher delivery.
    this.actors.pitcher.apply(samplePose(pitcherKeys(), (now - p.windupAt) / 1000));
    // Batter: load during the windup, then swing if he swings.
    const loadT = Math.min(1, (now - p.windupAt) / (p.releaseAt - p.windupAt));
    if (!this.animateSwing(now)) this.actors.batter.apply(samplePose(batterLoadKeys(), loadT));

    if (this.auto && this.isUserBatting() && !p.swing && now >= p.arrivalAt - SWING_TIME_MS - 5) {
      // Test hook: perfect swing at the ball.
      this.pciLoc = { ...p.traj.spec.plateLoc };
      this.userSwing(p.arrivalAt - SWING_TIME_MS + this.autoTimingMs + this.rng.gaussian(0, 10), 'normal');
    }

    if (now < p.releaseAt) {
      this.placeBallInHand();
      return;
    }
    if (this.phase === 'windup') {
      this.phase = 'flight';
      this.phaseAt = p.releaseAt;
    }
    if (!this.isUserBatting() && !p.cpuDecided) this.cpuDecide();

    // Catcher's mitt drifts toward where the ball is really going.
    const k = Math.min(1, (now - p.releaseAt) / (p.arrivalAt - p.releaseAt));
    const tgt = p.target;
    const act = p.traj.spec.plateLoc;
    const catchY = positionAt(p.traj, (p.catchAt - p.releaseAt) / 1000).y;
    const mix = { x: THREE.MathUtils.lerp(tgt.x, act.x, k), y: THREE.MathUtils.lerp(tgt.y, catchY, k) };
    this.actors.catcher.apply(catcherPose(this.mittLocal(mix, mix.y)));

    const t = Math.min(now, p.catchAt);
    const pos = positionAt(p.traj, (t - p.releaseAt) / 1000);
    this.ball.set(pos, (now - p.releaseAt) * 0.1);

    const s = p.swing;
    if (s && s.result.kind !== 'whiff') {
      // Contact happens when the bat gets there (never before the ball does).
      const hitAt = p.arrivalAt + Math.max(0, s.result.timingErrorMs);
      if (now >= hitAt) this.resolveAtPlate(hitAt);
      return;
    }

    if (now >= p.catchAt && !p.caught) {
      p.caught = true;
      this.sfx.mittPop(p.traj.spec.speedMph);
    }

    if (now >= p.callAt) {
      const swung = !!p.swing;
      let ev: PitchEvent;
      let call: string;
      if (swung) {
        ev = { type: 'swingingStrike' };
        call = 'Whiff';
      } else if (isStrike(p.traj.spec.plateLoc)) {
        ev = { type: 'calledStrike' };
        call = 'Strike';
      } else {
        ev = { type: 'ball' };
        call = 'Ball';
      }
      this.finishPitch(now, ev, call);
    }
  }

  /** Returns true if a swing animation is playing. */
  private animateSwing(now: number): boolean {
    const s = this.pitch?.swing;
    if (!s || now < s.at) return false;
    const t = (now - s.at) / 1000;
    if (t > SWING_DURATION + 1) return false;
    this.actors.batter.apply(samplePose(s.keys, t));
    return true;
  }

  private updateInPlay(now: number, dt: number): void {
    const ip = this.inPlay!;
    if (now - ip.contactAt < 0.5) this.animateSwing(now);
    ip.play.update(dt);
    if (ip.play.done) {
      const o = ip.play.outcome!;
      const ev: PitchEvent = o.kind === 'foul' ? { type: 'foul' } : { type: 'inPlay', play: o, exitVeloMph: ip.exitVeloMph };
      const call =
        o.kind === 'foul'
          ? 'Foul'
          : o.batterResult === 'out' || o.batterResult === 'fc'
            ? 'In play, out'
            : { single: 'Single', double: 'Double', triple: 'Triple', homeRun: 'Home run' }[o.batterResult];
      if (o.kind === 'play' && o.batterResult === 'homeRun') this.sfx.crowd(1, 4);
      this.finishPitch(now, ev, call);
    }
  }

  private mittLocal(loc: PlateLoc, y: number): [number, number, number] {
    // Catcher faces -z (rotated 180°): local x = -world x, local z = root z - world z.
    return [-loc.x, Math.max(0.5, y), CATCHER_ROOT_Z - CATCHER_Z];
  }

  // ---------------------------------------------------------------------------
  // Test hook support

  snapshot() {
    const st = this.host.state();
    return {
      role: this.host.role,
      phase: this.phase,
      count: { ...st.count },
      outs: st.outs,
      inning: st.inning,
      runs: st.runs,
      batting: { ...st.batting },
      pitching: { ...st.pitching },
      lastEvent: this.lastEvent,
      pitches: st.pitching.pitches,
      playT: this.inPlay ? Number(this.inPlay.play.sim.t.toFixed(2)) : null,
      playDone: this.inPlay ? this.inPlay.play.sim.done : null,
    };
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
