import * as THREE from 'three';
import './ui/hud.css';
import { Sfx } from './audio/sfx';
import { GameClock } from './core/clock';
import { Input } from './core/input';
import { tuning } from './core/tuning';
import { AtBatSession, type SessionDeps } from './modes/atBatSession';
import { GameSession, type GameSetupOptions } from './modes/gameSession';
import { PracticeHost, type PracticeOptions } from './modes/practiceHost';
import { CameraRig } from './scene/cameraRig';
import { buildStadium } from './scene/stadium';
import { createDebugPanel } from './ui/debugPanel';
import { Hud } from './ui/hud';
import { PauseMenu } from './ui/menu';
import { Home } from './ui/home';
import { ProfileStore } from './core/storage';
import { PlayerPreview } from './scene/preview';
import { divePose, fielderReadyPose, pickupPose, reachPose, runPose, throwPose, transferPose } from './scene/animations';
import { SeasonHub } from './ui/seasonHub';
import { finalRatings, newProfile, setPositions, type PlayerProfile } from './sim/profile';
import type { UserRole } from './sim/team';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui')!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#cfe3f5', 900, 3200);
buildStadium(renderer, scene);

const cam = new CameraRig(window.innerWidth / window.innerHeight);
cam.setShot('batting', cam.battingShot('R'), true);
const clock = new GameClock();
const input = new Input(canvas);
const sfx = new Sfx();
const hud = new Hud(uiRoot);

const deps: SessionDeps = { scene, cam, input, clock, hud, sfx };

type Current = { kind: 'practice'; session: AtBatSession; opts: PracticeOptions } | { kind: 'game'; session: GameSession; opts: GameSetupOptions };
let current: Current | null = null;

function stopCurrent(): void {
  current?.session.dispose();
  current = null;
}

function startPractice(opts: PracticeOptions, profile: PlayerProfile | null = home.activeProfile): void {
  sfx.unlock();
  stopCurrent();
  menu.hide();
  pause.hide();
  clock.setTimeScale(tuning.timeScale);
  current = { kind: 'practice', session: new AtBatSession(new PracticeHost(opts, profile), deps), opts };
}

/** Your player's ratings feed the tuning panel (which can still override them for testing). */
function useProfile(p: PlayerProfile | null): void {
  if (!p) return;
  const r = finalRatings(p);
  Object.assign(tuning.userBatter, r.batting);
  Object.assign(tuning.userPitcher, { velocity: r.pitching.velocity, control: r.pitching.control, movement: r.pitching.movement });
  gui?.controllersRecursive().forEach((c) => c.updateDisplay());
}

function startGame(opts: GameSetupOptions): void {
  sfx.unlock();
  stopCurrent();
  menu.hide();
  hub.hide();
  pause.hide();
  clock.setTimeScale(tuning.timeScale);
  const session = new GameSession(opts, { ...deps, uiRoot }, quitToMenu, () => startGame(opts));
  current = { kind: 'game', session, opts };
}

function quitToMenu(): void {
  stopCurrent();
  pause.hide();
  clock.setTimeScale(tuning.timeScale);
  menu.show();
}

function setPaused(p: boolean): void {
  if (!current) return;
  if (p) {
    clock.setTimeScale(0);
    const inGame = current.kind === 'game' && !current.session.finished;
    pause.show(inGame, current.kind === 'game' && !!current.opts.season);
  } else {
    clock.setTimeScale(tuning.timeScale);
    pause.hide();
  }
}

const store = new ProfileStore();
const preview = new PlayerPreview(scene);
// eslint-disable-next-line prefer-const
let gui: ReturnType<typeof createDebugPanel> | undefined;
const home = new Home(
  uiRoot,
  {
    practice: startPractice,
    game: startGame,
    profileChanged: useProfile,
    season: (slot, profile, difficulty) => {
      home.hide();
      hub.open(slot, profile, difficulty);
    },
  },
  store,
  preview,
);
const menu = home;
const hub = new SeasonHub(uiRoot, store, {
  play: startGame,
  leaveGame: () => {
    stopCurrent();
    pause.hide();
    clock.setTimeScale(tuning.timeScale);
    hub.show();
  },
  home: () => {
    hub.hide();
    home.show();
  },
  profileChanged: (p) => {
    home.setProfile(p);
    useProfile(p);
  },
});
const pause = new PauseMenu(uiRoot, {
  resume: () => setPaused(false),
  restart: () => {
    if (current?.kind === 'practice') startPractice(current.opts);
    else if (current?.kind === 'game') startGame(current.opts);
  },
  quit: () => {
    if (current?.kind === 'game' && current.opts.season) {
      setPaused(false);
      current.session.finishSeasonGame();
    } else quitToMenu();
  },
  simToEnd: () => {
    if (current?.kind === 'game') {
      setPaused(false);
      current.session.simToEnd();
    }
  },
});

gui = createDebugPanel((key) => {
  if (key === 'timeScale') {
    if (!pause.visible) clock.setTimeScale(tuning.timeScale);
  } else {
    current?.session.refreshTuning();
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setPaused(!pause.visible);
  if (e.key === '`') gui!._hidden ? gui!.show() : gui!.hide();
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  cam.resize(window.innerWidth / window.innerHeight);
});

// Idle menu camera: slow orbit around the infield.
function menuCamera(now: number, dt: number): void {
  // Home screen and creator: your player on a turntable.
  if (home.visible && preview.visible) {
    preview.update(dt, now, cam.camera, home.panelFraction);
    return;
  }
  const a = now / 12000;
  cam.camera.position.set(Math.sin(a) * 160, 70, Math.cos(a) * 160 - 90);
  cam.camera.fov = 45;
  cam.camera.updateProjectionMatrix();
  cam.camera.lookAt(0, 0, -90);
}

let lastReal = performance.now();
function frame(): void {
  const real = performance.now();
  const dt = Math.min(0.35, (real - lastReal) / 1000) * (pause.visible ? 0 : tuning.timeScale);
  lastReal = real;
  if (current) current.session.update(clock.now(), dt);
  else menuCamera(real, dt);
  renderer.render(scene, cam.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function testProfile(primary: UserRole, secondary: UserRole | null): PlayerProfile {
  return setPositions({ ...newProfile('test'), firstName: 'Test', lastName: 'Player' }, primary, secondary);
}

// Test hook for automated smoke tests (only with ?test in the URL).
if (new URLSearchParams(location.search).has('test')) {
  (window as unknown as { __game: unknown }).__game = {
    start: (opts: PracticeOptions) => startPractice({ seed: 42, ...opts }),
    startGame: (opts: Omit<GameSetupOptions, 'profile'> & { profile?: PlayerProfile }) =>
      startGame({ seed: 7, profile: opts.profile ?? home.activeProfile ?? testProfile('CF', null), ...opts } as GameSetupOptions),
    testProfile: (primary: UserRole, secondary: UserRole | null = null) => testProfile(primary, secondary),
    setAuto: (v: boolean, lateMs = 0) => {
      if (current?.kind === 'practice') {
        current.session.auto = v;
        current.session.autoTimingMs = lateMs;
      } else if (current?.kind === 'game') current.session.setAuto(v, lateMs);
    },
    snapshot: () => current?.session.snapshot() ?? null,
    forceHit: (ev: number, la: number, spray: number) => {
      if (current?.kind === 'practice') current.session.forceHit = { ev, la, spray };
    },
    simToEnd: () => current?.kind === 'game' && current.session.simToEnd(),
    setTimeScale: (s: number) => {
      tuning.timeScale = s;
      clock.setTimeScale(s);
    },
    setPlateLoc: (x: number, y: number) => input.setPlateLoc({ x, y }, cam.camera),
    quit: quitToMenu,
    season: () => hub.state,
    /** Hold a fielding pose on the home-screen preview model (for checking animations). */
    previewPose: (name: string, t = 0, spin = 0.9) => {
      const poses: Record<string, () => ReturnType<typeof runPose>> = {
        ready: () => fielderReadyPose(0, t),
        run: () => runPose(t, 1),
        reachLow: () => reachPose(fielderReadyPose(0, 1), [0.9, 0.5, 2.0]),
        reachHigh: () => reachPose(runPose(t, 0.6), [0.6, 7.2, 1.2]),
        dive: () => divePose(),
        transfer: () => transferPose(),
        pickup: () => pickupPose(),
        throw: () => throwPose(t),
      };
      preview.debugPose = { pose: poses[name](), rotX: name === 'dive' ? 1.2 : 0, spin };
    },
  };
}
