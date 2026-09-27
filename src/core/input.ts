import * as THREE from 'three';
import { ZONE_Z } from './constants';
import type { PlateLoc } from './types';

export type ClickButton = 'primary' | 'secondary';

export interface ClickEvent {
  button: ClickButton;
  shift: boolean;
  /** DOM event timestamp (performance.now timeline). */
  timeStamp: number;
}

/** Tracks the mouse on the canvas and projects it onto the zone plane. */
export class Input {
  private ndc = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -ZONE_Z);
  private hit = new THREE.Vector3();
  private clickHandlers: Array<(e: ClickEvent) => void> = [];
  private keyHandlers: Array<(e: KeyboardEvent) => void> = [];
  private held = new Set<string>();
  hasMouse = false;

  constructor(canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.hasMouse = true;
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      const ev: ClickEvent = { button: e.button === 2 ? 'secondary' : 'primary', shift: e.shiftKey, timeStamp: e.timeStamp };
      for (const h of this.clickHandlers) h(ev);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      this.held.add(e.key.toLowerCase());
      for (const h of this.keyHandlers) h(e);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.held.clear());
  }

  onClick(h: (e: ClickEvent) => void): () => void {
    this.clickHandlers.push(h);
    return () => (this.clickHandlers = this.clickHandlers.filter((x) => x !== h));
  }

  onKey(h: (e: KeyboardEvent) => void): () => void {
    this.keyHandlers.push(h);
    return () => (this.keyHandlers = this.keyHandlers.filter((x) => x !== h));
  }

  /** Is a key (KeyboardEvent.key, lower case) held down? */
  isDown(...keys: string[]): boolean {
    return keys.some((k) => this.held.has(k));
  }

  /** Test hook: press or release a key. */
  setKey(key: string, down: boolean): void {
    if (down) this.held.add(key);
    else this.held.delete(key);
  }

  /** Mouse position projected onto the zone plane, or null if it misses. */
  plateLoc(camera: THREE.Camera): PlateLoc | null {
    this.raycaster.setFromCamera(this.ndc, camera);
    const p = this.raycaster.ray.intersectPlane(this.plane, this.hit);
    return p ? { x: p.x, y: p.y } : null;
  }

  /** Move the virtual mouse to a plate location (used by the test hook). */
  setPlateLoc(loc: PlateLoc, camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    const v = new THREE.Vector3(loc.x, loc.y, ZONE_Z).project(camera);
    this.ndc.set(v.x, v.y);
    this.hasMouse = true;
  }
}
