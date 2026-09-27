import * as THREE from 'three';
import { BALL_RADIUS } from '../core/constants';
import type { Vec3 } from '../core/types';

const TRAIL_POINTS = 40;

/** The ball mesh (drawn a bit larger than life so it reads at a distance) plus an optional trail. */
export class BallView {
  readonly mesh: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  private readonly trail: THREE.Line;
  private readonly trailPositions: Float32Array;
  private trailCount = 0;
  showTrail = false;
  /** Minimum on-screen size: the ball is scaled up with camera distance so it never vanishes. */
  private camera: THREE.Camera | null = null;
  /** Extra size multiplier (the batting view draws the pitch bigger so it's easier to track). */
  boost = 1;
  private readonly glow: THREE.Sprite;

  constructor(scene: THREE.Scene) {
    const tex = ballTexture();
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS * 1.35, 16, 12),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, emissive: '#222222' }),
    );
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, opacity: 0.8 }),
    );
    this.glow.scale.setScalar(BALL_RADIUS * 6);
    this.glow.visible = false;
    this.mesh.add(this.glow);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.35, 16),
      new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.3, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    scene.add(this.shadow);

    this.trailPositions = new Float32Array(TRAIL_POINTS * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 }));
    this.trail.frustumCulled = false;
    scene.add(this.trail);
    this.hide();
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  set(p: Vec3, spinAngle = 0, trail = this.showTrail): void {
    this.mesh.visible = true;
    this.mesh.position.set(p.x, p.y, p.z);
    if (this.camera) {
      const d = this.camera.position.distanceTo(this.mesh.position);
      this.mesh.scale.setScalar(Math.max(this.boost, d / 55));
    }
    this.mesh.rotation.x = spinAngle;
    this.shadow.visible = p.y < 150;
    this.shadow.position.set(p.x, 0.05, p.z);
    const s = Math.max(0.3, 1 - p.y / 120);
    this.shadow.scale.setScalar(s);
    if (trail) this.pushTrail(p);
  }

  setGlow(on: boolean): void {
    this.glow.visible = on;
  }

  clearTrail(): void {
    this.trailCount = 0;
    this.trail.geometry.setDrawRange(0, 0);
  }

  private pushTrail(p: Vec3): void {
    const arr = this.trailPositions;
    if (this.trailCount < TRAIL_POINTS) {
      this.trailCount++;
    } else {
      arr.copyWithin(0, 3);
    }
    const i = (this.trailCount - 1) * 3;
    arr[i] = p.x;
    arr[i + 1] = p.y;
    arr[i + 2] = p.z;
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, this.trailCount);
    this.trail.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
    this.shadow.visible = false;
    this.trail.visible = false;
    this.clearTrail();
  }
}

function ballTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fbfaf5';
  ctx.fillRect(0, 0, 128, 64);
  ctx.strokeStyle = '#d23a2e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let x = 0; x <= 128; x += 2) {
    const y = 32 + Math.sin((x / 128) * Math.PI * 4) * 16;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,250,220,0.35)');
  g.addColorStop(1, 'rgba(255,250,220,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
