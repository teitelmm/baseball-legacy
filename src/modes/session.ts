import * as THREE from 'three';
import {
  CATCHER_Z,
  DIFFICULTIES,
  INCH,
  MOUND_HEIGHT,
  RUBBER_Z,
  SWING_TIME_MS,
  type Difficulty,
  type DifficultyName,
} from '../core/constants';
import type { GameClock } from '../core/clock';
import type { Input, ClickEvent } from '../core/input';
import { Rng } from '../core/rng';
import { tuning } from '../core/tuning';
import type { Batter, Handedness, Pitcher, PitchTypeId, PlateLoc, SwingType, Vec3 } from '../core/types';
import type { Sfx } from '../audio/sfx';
import { applyPitch, newGameState, type GameState, type PitchEvent } from '../sim/atBat';
import { decideCpuSwing } from '../sim/ai/cpuBatter';
import { planCpuPitch } from '../sim/ai/cpuPitcher';
import { pathPositionAt, simulateBattedBall, type BattedBallPath } from '../sim/battedBall';
import { classifyBattedBall, type BallInPlayOutcome } from '../sim/outcome';
import { effortBonusMph, missInches, PitchMeter, powerSpeedFactor } from '../sim/pitchMeter';
import { buildPitch, positionAt, timeAtZ, type PitchSpec, type PitchTrajectory } from '../sim/pitchPhysics';
import { maxVelocity, movementScale, PITCH_ORDER, PITCH_TYPES } from '../sim/pitchTypes';
import { evaluateSwing, pciSize, timingWindows, type SwingParams, type SwingResult } from '../sim/swing';
import { isStrike } from '../sim/zone';
import {
  BATTER_STANCE,
  batterLoadKeys,
  batterSwingKeys,
  catcherPose,
  fielderReadyPose,
  pitcherKeys,
  pitcherSetPose,
  SWING_DURATION,
  UMPIRE_POSE,
  WINDUP_DURATION,
} from '../scene/animations';
import { BallView } from '../scene/ballView';
import type { CameraRig } from '../scene/cameraRig';
import { Humanoid, samplePose, type Appearance, type Keyframes } from '../scene/humanoid';
import { ZoneOverlay } from '../scene/zoneOverlay';
import type { Hud, PitchLogEntry } from '../ui/hud';

export type Role = 'batting' | 'pitching';
export type Phase = 'prePitch' | 'windup' | 'flight' | 'inPlay' | 'result';

export interface SessionOptions {
  role: Role;
  difficulty: DifficultyName;
  /** Your batting side (batting practice) or throwing arm (pitching practice). */
  userHand: Handedness;
  /** The CPU opponent's hand. 'S' mixes it up batter to batter. */
  cpuHand: Handedness | 'S';
  seed?: number;
}

const BATTER_OFFSET = 2.6; // ft from the plate center to the batter's root
const CATCHER_ROOT_Z = CATCHER_Z + 1.0;
const PRE_PITCH_MS = 1300;
const RESULT_MS = 1400;
const IN_PLAY_RESULT_MS = 2600;

const HOME_TEAM: Appearance = { jersey: '#f4f4f0', pants: '#f0f0ea', skin: '#c68d62', cap: '#1d3b72', undershirt: '#1d3b72' };
const AWAY_TEAM: Appearance = { jersey: '#9aa3ad', pants: '#b8bfc7', skin: '#8d5a3b', cap: '#b3261e', undershirt: '#b3261e' };
const UMPIRE: Appearance = { jersey: '#1b2230', pants: '#59606b', skin: '#e0b48f', cap: '#111111' };

const CPU_NAMES = ['M. Alvarez', 'J. Brooks', 'T. Nakamura', 'D. Okafor', 'R. Castillo', 'K. Whitfield', 'L. Moreau', 'S. Park', 'C. Ramirez', 'B. Lindqvist'];

const FIELDER_SPOTS: Array<[number, number]> = [
  [58, -82], // 1B
  [30, -128], // 2B
  [-32, -128], // SS
  [-60, -84], // 3B
  [-150, -255], // LF
  [0, -312], // CF
  [150, -255], // RF
];

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
  path: BattedBallPath;
  contactAt: number;
  outcome: BallInPlayOutcome;
  endAt: number;
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

export class PracticeSession {
  readonly opts: SessionOptions;
  readonly difficulty: Difficulty;
  phase: Phase = 'prePitch';
  state: GameState = newGameState();
  private phaseAt = 0;
  private rng: Rng;
  private group = new THREE.Group();

  private batter: Batter;
  private pitcher: Pitcher;
  private batterModel!: Humanoid;
  private pitcherModel: Humanoid;
  private catcherModel: Humanoid;
  private umpireModel: Humanoid;
  private fielders: Humanoid[] = [];
  private runners: Humanoid[] = [];
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
  private batterIndex = 0;
  private unsubs: Array<() => void> = [];
  private lastEvent = '';
  /** Test hook: automatically swing (batting) or pitch (pitching). */
  auto = false;
  /** Test hook: how late (ms) the automatic swing is. */
  autoTimingMs = 0;

  constructor(
    opts: SessionOptions,
    private readonly scene: THREE.Scene,
    private readonly cam: CameraRig,
    private readonly input: Input,
    private readonly clock: GameClock,
    private readonly hud: Hud,
    private readonly sfx: Sfx,
  ) {
    this.opts = opts;
    this.difficulty = DIFFICULTIES[opts.difficulty];
    this.rng = new Rng(opts.seed ?? Date.now());
    scene.add(this.group);

    const cpuRating = tuning.cpuRatingOverride || this.difficulty.cpuRating;
    const userIsBatting = opts.role === 'batting';

    // Pitcher.
    const pitcherHand: Handedness = userIsBatting ? this.cpuHandFor(0) : opts.userHand;
    this.pitcher = userIsBatting
      ? {
          name: 'CPU Pitcher',
          throws: pitcherHand,
          ratings: {
            velocity: tuning.cpuRatingOverride || this.difficulty.cpuPitcherStuff,
            control: cpuRating,
            movement: tuning.cpuRatingOverride || this.difficulty.cpuPitcherStuff,
          },
          repertoire: this.cpuRepertoire(),
        }
      : { name: 'You', throws: pitcherHand, ratings: { ...tuning.userPitcher }, repertoire: [...PITCH_ORDER] };

    const offense = userIsBatting ? HOME_TEAM : AWAY_TEAM;
    const defense = userIsBatting ? AWAY_TEAM : HOME_TEAM;

    this.batter = this.makeBatter(0);
    this.buildBatterModel(offense);

    this.pitcherModel = new Humanoid({ ...defense, gloveHand: 'L' }, { mirrored: pitcherHand === 'L' });
    this.pitcherModel.root.position.set(0, MOUND_HEIGHT, RUBBER_Z);
    this.pitcherModel.apply(pitcherSetPose());
    this.group.add(this.pitcherModel.root);

    this.catcherModel = new Humanoid({ ...defense, gloveHand: 'L' });
    this.catcherModel.root.position.set(0, 0, CATCHER_ROOT_Z);
    this.catcherModel.root.rotation.y = Math.PI;
    this.catcherModel.apply(catcherPose([0, 2.5, 1]));
    this.group.add(this.catcherModel.root);

    this.umpireModel = new Humanoid(UMPIRE);
    this.umpireModel.root.position.set(0, 0, CATCHER_ROOT_Z + 2.2);
    this.umpireModel.root.rotation.y = Math.PI;
    this.umpireModel.apply(UMPIRE_POSE);
    this.group.add(this.umpireModel.root);

    for (const [x, z] of FIELDER_SPOTS) {
      const f = new Humanoid({ ...defense, gloveHand: 'L' });
      f.root.position.set(x, 0, z);
      f.root.rotation.y = Math.atan2(-x, -z);
      f.apply(fielderReadyPose(this.rng.range(0, 6)));
      this.group.add(f.root);
      this.fielders.push(f);
    }

    const r2 = Math.SQRT1_2;
    const bases: Array<[number, number]> = [
      [90 * r2 + 3, -90 * r2 + 2],
      [3, -90 * Math.SQRT2 + 2],
      [-90 * r2 - 2, -90 * r2 + 3],
    ];
    for (const [x, z] of bases) {
      const r = new Humanoid({ ...offense, gloveHand: null });
      r.root.position.set(x, 0, z);
      r.root.rotation.y = Math.atan2(-x, -z);
      r.apply(fielderReadyPose(0));
      r.root.visible = false;
      this.group.add(r.root);
      this.runners.push(r);
    }

    this.ball = new BallView(scene);
    this.ball.setCamera(cam.camera);
    this.zone = new ZoneOverlay(scene);
    this.syncPciSize();

    this.unsubs.push(input.onClick((e) => this.onClick(e)));
    this.unsubs.push(input.onKey((e) => this.onKey(e)));

    const shot = userIsBatting ? cam.battingShot(this.batter.bats) : cam.pitchingShot(this.pitcher.throws);
    cam.setShot(userIsBatting ? 'batting' : 'pitching', shot, true);

    this.hud.show();
    this.hud.clearFeedback();
    this.refreshHud();
    this.enterPrePitch(clock.now());
  }

  // ---------------------------------------------------------------------------
  // Setup helpers

  private cpuHandFor(i: number): Handedness {
    const h = this.opts.cpuHand;
    if (h === 'S') return i % 3 === 2 ? 'L' : this.rng.chance(0.35) ? 'L' : 'R';
    return h;
  }

  private cpuRepertoire(): PitchTypeId[] {
    const fastball: PitchTypeId = this.rng.chance(0.65) ? 'FF' : 'SI';
    const others = (['SL', 'CU', 'CH'] as PitchTypeId[]).filter(() => this.rng.chance(0.75));
    if (others.length < 2) others.push(...(['SL', 'CH'] as PitchTypeId[]).filter((p) => !others.includes(p)));
    return [fastball, ...others];
  }

  private makeBatter(i: number): Batter {
    if (this.opts.role === 'batting') {
      return { name: 'You', bats: this.opts.userHand, ratings: { ...tuning.userBatter } };
    }
    const r = tuning.cpuRatingOverride || this.difficulty.cpuRating;
    const jitter = () => Math.max(20, Math.min(99, r + this.rng.gaussian(0, 8)));
    return {
      name: CPU_NAMES[i % CPU_NAMES.length],
      bats: this.cpuHandFor(i),
      ratings: { contact: jitter(), power: jitter(), eye: jitter() },
    };
  }

  private buildBatterModel(app: Appearance): void {
    if (this.batterModel) this.group.remove(this.batterModel.root);
    const lefty = this.batter.bats === 'L';
    this.batterModel = new Humanoid({ ...app, gloveHand: null }, { bat: true, mirrored: lefty });
    this.batterModel.root.position.set(lefty ? BATTER_OFFSET : -BATTER_OFFSET, 0, -0.4);
    this.batterModel.root.rotation.y = lefty ? -Math.PI / 2 : Math.PI / 2;
    this.batterModel.apply(BATTER_STANCE);
    this.group.add(this.batterModel.root);
  }

  /** Pick up rating / PCI changes from the debug panel. */
  refreshTuning(): void {
    if (this.isUserBatting()) this.batter.ratings = { ...tuning.userBatter };
    else this.pitcher.ratings = { ...tuning.userPitcher };
    this.syncPciSize();
    if (this.phase === 'prePitch' && !this.isUserBatting() && this.meter?.phase === 'idle') this.refreshPitchMenu();
  }

  private syncPciSize(): void {
    const s = pciSize('normal', tuning.userBatter.contact, swingParams(this.difficulty));
    this.zone.setPciSize(s.outerHalfW, s.outerHalfH, s.innerHalfW, s.innerHalfH);
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.scene.remove(this.group);
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
    return this.opts.role === 'batting';
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
    this.batterModel.apply(BATTER_STANCE);
    this.pitcherModel.apply(pitcherSetPose());
    this.catcherModel.apply(catcherPose([0, 2.4, 1]));
    for (const f of this.fielders) f.root.rotation.y = Math.atan2(-f.root.position.x, -f.root.position.z);

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
    this.catcherModel.apply(catcherPose(this.mittLocal(target, 2.4)));
  }

  private cpuPitch(now: number): void {
    const plan = planCpuPitch(this.pitcher, this.state.count, this.batter.bats, this.rng, this.difficulty.cpuZoneBias);
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
    const d = decideCpuSwing(this.batter, p.traj, this.state.count, this.prevPitchMph, this.rng);
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
    }
    const start: Vec3 = { x: p.traj.spec.plateLoc.x, y: p.traj.spec.plateLoc.y, z: -0.3 };
    const path = simulateBattedBall({ exitVeloMph: ev, launchAngleDeg: la, sprayDeg: spray, start });
    const outcome = r.kind === 'foulTip' ? ({ kind: 'foul', label: 'Foul tip' } as const) : classifyBattedBall(path, this.rng);
    const endAt =
      now +
      1000 *
        (outcome.kind === 'foul'
          ? Math.min(path.duration, path.landingTime + 0.8, 3.2)
          : path.homeRun
            ? Math.min(path.duration, path.landingTime + 0.5)
            : Math.min(path.duration, path.landingTime + 1.6, 7));
    this.inPlay = { path, contactAt: now, outcome, endAt };
    this.phase = 'inPlay';
    this.phaseAt = now;
    this.sfx.batCrack(quality);
    if (outcome.kind !== 'foul' && ev > 95 && la > 15) this.sfx.crowd(Math.min(1, (ev - 90) / 20), 3);
    this.cam.setShot('follow', null);
  }

  private finishPitch(now: number, ev: PitchEvent, call: string): void {
    const p = this.pitch!;
    const out = applyPitch(this.state, ev);
    this.state = out.state;
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
      const bb = this.inPlay.path;
      const o = ev.outcome;
      const title = description;
      const detail = [
        `${timing(r.timingErrorMs, r.timingLabel)} · ${r.contactLabel}`,
        `${r.exitVeloMph.toFixed(1)} mph · ${r.launchAngleDeg.toFixed(0)}° · ${Math.round(bb.distance)} ft`,
        extra,
      ]
        .filter(Boolean)
        .join('<br>');
      const good = o.kind === 'hit';
      const tone = o.kind === 'hit' && o.hit === 'homeRun' ? 'big' : o.kind === 'foul' ? 'neutral' : good === batting ? 'good' : 'bad';
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
    this.hud.feedback(description, detail, tone, 2000);
  }

  private endResult(now: number): void {
    if (this.pendingPaEnd) {
      this.pitchLog = [];
      this.zone.clearMarkers();
      if (!this.isUserBatting()) {
        this.batterIndex++;
        this.batter = this.makeBatter(this.batterIndex);
        this.buildBatterModel(AWAY_TEAM);
      }
    }
    this.pendingPaEnd = false;
    this.refreshHud();
    this.enterPrePitch(now);
  }

  private refreshHud(): void {
    const displayState = this.state.outs >= 3 && this.phase !== 'result' ? { ...this.state, outs: 0, bases: [false, false, false] as [boolean, boolean, boolean], count: { balls: 0, strikes: 0 }, inning: this.state.inning + 1 } : this.state;
    this.hud.update(displayState, this.opts.role);
    const hand = (h: Handedness) => (h === 'R' ? 'RHP' : 'LHP');
    const bats = (h: Handedness) => (h === 'R' ? 'R' : 'L');
    this.hud.setMatchup(
      `${this.pitcher.name} <span class="lbl">${hand(this.pitcher.throws)}</span>`,
      `${this.batter.name} <span class="lbl">BATS ${bats(this.batter.bats)}</span>`,
    );
    this.hud.setLog(this.pitchLog);
    displayState.bases.forEach((on, i) => (this.runners[i].root.visible = on));
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
    this.catcherModel.root.visible = !battingCam;
    this.umpireModel.root.visible = !battingCam;

    switch (this.phase) {
      case 'prePitch':
        this.updatePrePitch(now);
        break;
      case 'windup':
      case 'flight':
        this.updatePitch(now);
        break;
      case 'inPlay':
        this.updateInPlay(now);
        break;
      case 'result': {
        const hold = this.inPlay ? IN_PLAY_RESULT_MS : RESULT_MS;
        if (this.inPlay) this.updateBallInPlayVisual(now);
        this.animateSwing(now);
        if (now - this.phaseAt > hold) this.endResult(now);
        break;
      }
    }

    // Idle fielders.
    this.fielders.forEach((f, i) => {
      if (!this.inPlay) f.apply(fielderReadyPose(now / 600 + i));
    });
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
    const hand = this.pitcherModel.handPosition('R');
    this.pitcherModel.root.updateMatrixWorld();
    hand.applyMatrix4(this.pitcherModel.root.matrixWorld);
    this.ball.set(hand);
    this.ball.clearTrail();
  }

  private updatePitch(now: number): void {
    const p = this.pitch!;
    // Pitcher delivery.
    this.pitcherModel.apply(samplePose(pitcherKeys(), (now - p.windupAt) / 1000));
    // Batter: load during the windup, then swing if he swings.
    const loadT = Math.min(1, (now - p.windupAt) / (p.releaseAt - p.windupAt));
    if (!this.animateSwing(now)) this.batterModel.apply(samplePose(batterLoadKeys(), loadT));

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
    this.catcherModel.apply(catcherPose(this.mittLocal(mix, mix.y)));

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
    this.batterModel.apply(samplePose(s.keys, t));
    return true;
  }

  private updateBallInPlayVisual(now: number): void {
    const ip = this.inPlay!;
    const t = (now - ip.contactAt) / 1000;
    const pos = pathPositionAt(ip.path, Math.min(t, ip.path.duration));
    this.ball.set(pos, t * 20, true);
    this.cam.follow(pos);
    // Fielders turn to watch the ball.
    for (const f of this.fielders) {
      f.root.rotation.y = Math.atan2(pos.x - f.root.position.x, pos.z - f.root.position.z);
    }
  }

  private updateInPlay(now: number): void {
    this.animateSwing(now);
    this.updateBallInPlayVisual(now);
    const ip = this.inPlay!;
    if (now >= ip.endAt) {
      const swing = this.pitch!.swing!;
      const ev: PitchEvent = {
        type: 'inPlay',
        outcome: ip.outcome,
        exitVeloMph: swing.result.kind === 'contact' ? swing.result.exitVeloMph : 0,
      };
      const call = ip.outcome.kind === 'foul' ? 'Foul' : ip.outcome.kind === 'hit' ? ip.outcome.label.replace('!', '') : 'In play, out';
      if (ip.outcome.kind === 'hit' && ip.outcome.hit === 'homeRun') this.sfx.crowd(1, 4);
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
    return {
      role: this.opts.role,
      phase: this.phase,
      count: { ...this.state.count },
      outs: this.state.outs,
      inning: this.state.inning,
      runs: this.state.runs,
      batting: { ...this.state.batting },
      pitching: { ...this.state.pitching },
      lastEvent: this.lastEvent,
      pitches: this.state.pitching.pitches,
    };
  }
}
