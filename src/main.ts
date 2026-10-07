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
import type { Game } from './sim/gameSim';
import { pointsForGame } from './sim/season';
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
const stadium = buildStadium(renderer, scene);

// A soft vignette drawn over the frame (darker toward the corners).
const vignetteScene = new THREE.Scene();
const vignetteCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
{
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 70, 128, 128, 182);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  vignetteScene.add(
    new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })),
  );
}

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
  // Exhibition games with your saved player earn skill points too (half the season rate).
  const own = !opts.season && opts.profile.id === home.activeProfile?.id;
  const run: GameSetupOptions = own ? { ...opts, onFinished: exhibitionPoints } : opts;
  const session = new GameSession(run, { ...deps, uiRoot }, quitToMenu, () => startGame(opts));
  current = { kind: 'game', session, opts };
}

function exhibitionPoints(g: Game, userId: string, fieldingOuts: number): number {
  const userHome = g.home.id === 'user';
  const won = userHome ? g.score.home > g.score.away : g.score.away > g.score.home;
  const pts = Math.floor(pointsForGame(g, userId, won, fieldingOuts) / 2);
  home.addSkillPoints(pts);
  return pts;
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
  stadium.followShadows(cam.camera);
  renderer.render(scene, cam.camera);
  renderer.autoClear = false;
  renderer.render(vignetteScene, vignetteCam);
  renderer.autoClear = true;
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
    /** Point the camera somewhere (for screenshots of the park). */
    camShot: (px: number, py: number, pz: number, lx: number, ly: number, lz: number, fov = 50) =>
      cam.setShot('custom', { pos: new THREE.Vector3(px, py, pz), look: new THREE.Vector3(lx, ly, lz), fov }, true),
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
