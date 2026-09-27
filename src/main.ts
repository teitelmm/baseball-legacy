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
import { Menu, PauseMenu } from './ui/menu';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui')!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#cfe3f5', 900, 3200);
scene.add(buildStadium(renderer));

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

function startPractice(opts: PracticeOptions): void {
  sfx.unlock();
  stopCurrent();
  menu.hide();
  pause.hide();
  clock.setTimeScale(tuning.timeScale);
  current = { kind: 'practice', session: new AtBatSession(new PracticeHost(opts), deps), opts };
}

function startGame(opts: GameSetupOptions): void {
  sfx.unlock();
  stopCurrent();
  menu.hide();
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
    pause.show(current.kind === 'game' && !current.session.finished);
  } else {
    clock.setTimeScale(tuning.timeScale);
    pause.hide();
  }
}

const menu = new Menu(uiRoot, { practice: startPractice, game: startGame });
const pause = new PauseMenu(uiRoot, {
  resume: () => setPaused(false),
  restart: () => {
    if (current?.kind === 'practice') startPractice(current.opts);
    else if (current?.kind === 'game') startGame(current.opts);
  },
  quit: quitToMenu,
  simToEnd: () => {
    if (current?.kind === 'game') {
      setPaused(false);
      current.session.simToEnd();
    }
  },
});

const gui = createDebugPanel((key) => {
  if (key === 'timeScale') {
    if (!pause.visible) clock.setTimeScale(tuning.timeScale);
  } else {
    current?.session.refreshTuning();
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setPaused(!pause.visible);
  if (e.key === '`') gui._hidden ? gui.show() : gui.hide();
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  cam.resize(window.innerWidth / window.innerHeight);
});

// Idle menu camera: slow orbit around the infield.
function menuCamera(now: number): void {
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
  else menuCamera(real);
  renderer.render(scene, cam.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test hook for automated smoke tests (only with ?test in the URL).
if (new URLSearchParams(location.search).has('test')) {
  (window as unknown as { __game: unknown }).__game = {
    start: (opts: PracticeOptions) => startPractice({ seed: 42, ...opts }),
    startGame: (opts: GameSetupOptions) => startGame({ seed: 7, ...opts }),
    setAuto: (v: boolean, lateMs = 0) => {
      if (current?.kind === 'practice') {
        current.session.auto = v;
        current.session.autoTimingMs = lateMs;
      } else if (current?.kind === 'game') current.session.setAuto(v, lateMs);
    },
    snapshot: () => current?.session.snapshot() ?? null,
    simToEnd: () => current?.kind === 'game' && current.session.simToEnd(),
    setTimeScale: (s: number) => {
      tuning.timeScale = s;
      clock.setTimeScale(s);
    },
    setPlateLoc: (x: number, y: number) => input.setPlateLoc({ x, y }, cam.camera),
    quit: quitToMenu,
  };
}
