import * as THREE from 'three';
import './ui/hud.css';
import { Sfx } from './audio/sfx';
import { GameClock } from './core/clock';
import { Input } from './core/input';
import { tuning } from './core/tuning';
import { PracticeSession, type SessionOptions } from './modes/session';
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

let session: PracticeSession | null = null;
let lastOpts: SessionOptions | null = null;

function start(opts: SessionOptions): void {
  sfx.unlock();
  session?.dispose();
  lastOpts = opts;
  menu.hide();
  pause.hide();
  clock.setTimeScale(tuning.timeScale);
  session = new PracticeSession(opts, scene, cam, input, clock, hud, sfx);
}

function quitToMenu(): void {
  session?.dispose();
  session = null;
  pause.hide();
  clock.setTimeScale(tuning.timeScale);
  menu.show();
}

function setPaused(p: boolean): void {
  if (!session) return;
  if (p) {
    clock.setTimeScale(0);
    pause.show();
  } else {
    clock.setTimeScale(tuning.timeScale);
    pause.hide();
  }
}

const menu = new Menu(uiRoot, start);
const pause = new PauseMenu(uiRoot, {
  resume: () => setPaused(false),
  restart: () => lastOpts && start(lastOpts),
  quit: quitToMenu,
});

const gui = createDebugPanel((key) => {
  if (key === 'timeScale') {
    if (!pause.visible) clock.setTimeScale(tuning.timeScale);
  } else {
    session?.refreshTuning();
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
  const dt = Math.min(0.1, (real - lastReal) / 1000) * (pause.visible ? 0 : tuning.timeScale);
  lastReal = real;
  if (session) session.update(clock.now(), dt);
  else menuCamera(real);
  renderer.render(scene, cam.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test hook for automated smoke tests (only with ?test in the URL).
if (new URLSearchParams(location.search).has('test')) {
  (window as unknown as { __game: unknown }).__game = {
    start: (opts: SessionOptions) => start({ seed: 42, ...opts }),
    setAuto: (v: boolean) => session && (session.auto = v),
    snapshot: () => session?.snapshot() ?? null,
    setTimeScale: (s: number) => {
      tuning.timeScale = s;
      clock.setTimeScale(s);
    },
    setPlateLoc: (x: number, y: number) => input.setPlateLoc({ x, y }, cam.camera),
    quit: quitToMenu,
  };
}
