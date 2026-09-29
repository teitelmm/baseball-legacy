import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  BASE_DISTANCE,
  fenceDistance,
  FOUL_ANGLE,
  MOUND_HEIGHT,
  PLATE_DEPTH,
  PLATE_HALF_WIDTH,
  RUBBER_Z,
  WALL_HEIGHT,
} from '../core/constants';
import { stadiumBoundary } from '../sim/field';

const GRASS_A = '#3f8a3a';
const GRASS_B = '#4a9a42';
const DIRT = '#b67a4a';
const DIRT_DARK = '#a46b3e';
const CHALK = '#f4f1e8';

const deg = THREE.MathUtils.degToRad;

/** Direction (x, z) for a spray angle: 0 = center field (-z), + = right field (+x). */
function sprayDir(angleDeg: number): [number, number] {
  const a = deg(angleDeg);
  return [Math.sin(a), -Math.cos(a)];
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Seeded random so the ground and crowd look the same on every load. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Break up flat colors: soft light/dark patches (worn grass, damp dirt) plus fine grain.
 * Transparent pixels stay transparent.
 */
function weather(canvas: HTMLCanvasElement, grain: number, patches: number, patchPx: number, seed: number): void {
  const ctx = canvas.getContext('2d')!;
  const rand = seededRandom(seed);
  const { width: w, height: h } = canvas;
  if (patches > 0) {
    const [small, sctx] = makeCanvas(Math.max(2, Math.ceil(w / patchPx)), Math.max(2, Math.ceil(h / patchPx)));
    const img = sctx.createImageData(small.width, small.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (rand() - 0.5) * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    const [big, bctx] = makeCanvas(w, h);
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(small, 0, 0, w, h);
    // Keep the patches off transparent areas.
    bctx.globalCompositeOperation = 'destination-in';
    bctx.drawImage(canvas, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = patches;
    ctx.drawImage(big, 0, 0);
    ctx.restore();
  }
  if (grain > 0) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const n = (rand() - 0.5) * grain;
      d[i] += n;
      d[i + 1] += n * 1.05;
      d[i + 2] += n * 0.8;
    }
    ctx.putImageData(img, 0, 0);
  }
}

/** Tiling grayscale noise used as a bump map: blades of grass and grains of dirt up close. */
function detailBump(maxAniso: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 256);
  const rand = seededRandom(77);
  const img = ctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 90 + rand() * 120;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Short streaks read as grass blades.
  for (let i = 0; i < 1400; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    ctx.strokeStyle = rand() < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 3, y + 2 + rand() * 4);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  return t;
}

interface GroundRegion {
  xmin: number;
  xmax: number;
  zmin: number;
  zmax: number;
  ppf: number;
}

function groundTexture(region: GroundRegion, draw: (ctx: CanvasRenderingContext2D, toPx: (x: number, z: number) => [number, number], s: number) => void, maxAniso: number): THREE.CanvasTexture {
  const w = Math.round((region.xmax - region.xmin) * region.ppf);
  const h = Math.round((region.zmax - region.zmin) * region.ppf);
  const [canvas, ctx] = makeCanvas(w, h);
  const toPx = (x: number, z: number): [number, number] => [(x - region.xmin) * region.ppf, (z - region.zmin) * region.ppf];
  draw(ctx, toPx, region.ppf);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function groundPlane(region: GroundRegion, tex: THREE.Texture, y: number, transparent: boolean, bump: THREE.Texture): THREE.Mesh {
  const w = region.xmax - region.xmin;
  const h = region.zmax - region.zmin;
  const bumpMap = bump.clone();
  bumpMap.repeat.set(w / 3, h / 3);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: tex, bumpMap, bumpScale: 1.2, roughness: 0.95, transparent, depthWrite: !transparent }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set((region.xmin + region.xmax) / 2, y, (region.zmin + region.zmax) / 2);
  m.receiveShadow = true;
  return m;
}

function fencePath(ctx: CanvasRenderingContext2D, toPx: (x: number, z: number) => [number, number], inset: number) {
  ctx.beginPath();
  const [hx, hy] = toPx(0, 0);
  ctx.moveTo(hx, hy);
  for (let a = -FOUL_ANGLE; a <= FOUL_ANGLE + 1e-6; a += 1) {
    const [dx, dz] = sprayDir(a);
    const d = fenceDistance(a) - inset;
    ctx.lineTo(...toPx(dx * d, dz * d));
  }
  ctx.closePath();
}

function drawField(ctx: CanvasRenderingContext2D, toPx: (x: number, z: number) => [number, number], s: number) {
  // Foul territory grass.
  ctx.fillStyle = GRASS_A;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Warning track: the whole fair territory in dirt, then grass painted back inside it.
  fencePath(ctx, toPx, 0);
  ctx.fillStyle = DIRT_DARK;
  ctx.fill();

  ctx.save();
  fencePath(ctx, toPx, 15);
  ctx.clip();
  ctx.fillStyle = GRASS_A;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // Mowing pattern: diagonal checkerboard.
  const [ox, oy] = toPx(0, 0);
  ctx.translate(ox, oy);
  ctx.rotate(Math.PI / 4);
  const band = 30 * s;
  ctx.fillStyle = GRASS_B;
  for (let i = -30; i < 30; i++) {
    for (let j = -30; j < 30; j++) {
      if ((i + j) % 2 === 0) ctx.fillRect(i * band, j * band, band, band);
    }
  }
  ctx.restore();

  weather(ctx.canvas, 14, 0.35, 18 * s, 11);

  // Foul lines all the way to the poles.
  ctx.strokeStyle = CHALK;
  ctx.lineWidth = Math.max(1, 0.3 * s);
  for (const a of [-FOUL_ANGLE, FOUL_ANGLE]) {
    const [dx, dz] = sprayDir(a);
    const d = fenceDistance(a);
    ctx.beginPath();
    ctx.moveTo(...toPx(0, 0));
    ctx.lineTo(...toPx(dx * d, dz * d));
    ctx.stroke();
  }
}

function drawInfield(ctx: CanvasRenderingContext2D, toPx: (x: number, z: number) => [number, number], s: number) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const circle = (x: number, z: number, r: number, color: string) => {
    ctx.beginPath();
    ctx.arc(...toPx(x, z), r * s, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  };

  // Infield dirt: arc of 95 ft around the front of the rubber, bounded by the foul lines (plus a little).
  const mound: [number, number] = [0, RUBBER_Z + 1.5];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(...toPx(0, 4));
  const [lx, lz] = sprayDir(-FOUL_ANGLE - 6);
  const [rx, rz] = sprayDir(FOUL_ANGLE + 6);
  ctx.lineTo(...toPx(lx * 200, lz * 200));
  ctx.lineTo(...toPx(rx * 200, rz * 200));
  ctx.closePath();
  ctx.clip();
  circle(mound[0], mound[1], 95, DIRT);
  ctx.restore();

  // Infield grass square (inside the base paths).
  const b = BASE_DISTANCE;
  const r2 = Math.SQRT1_2;
  const first: [number, number] = [b * r2, -b * r2];
  const second: [number, number] = [0, -b * Math.SQRT2];
  const third: [number, number] = [-b * r2, -b * r2];
  const inset = 5;
  ctx.beginPath();
  ctx.moveTo(...toPx(0, -inset * Math.SQRT2 - 8));
  ctx.lineTo(...toPx(first[0] - inset * Math.SQRT2, first[1]));
  ctx.lineTo(...toPx(second[0], second[1] + inset * Math.SQRT2));
  ctx.lineTo(...toPx(third[0] + inset * Math.SQRT2, third[1]));
  ctx.closePath();
  ctx.fillStyle = GRASS_A;
  ctx.fill();
  // The rounded grass edge behind the base paths is covered by the arc; knock out
  // a little grass to show the dirt base cutouts.
  for (const p of [first, second, third]) circle(p[0], p[1], 13, DIRT);

  // Mound and home plate circles.
  circle(mound[0], mound[1] - 1.5, 9, DIRT);
  circle(0, -PLATE_DEPTH / 2, 13, DIRT);

  weather(ctx.canvas, 16, 0.28, 5 * s, 23);

  // Base paths (dirt strips outside the grass).
  ctx.strokeStyle = CHALK;
  ctx.lineWidth = Math.max(1, 0.3 * s);
  ctx.beginPath();
  ctx.moveTo(...toPx(0, 0));
  ctx.lineTo(...toPx(first[0] * 1.6, first[1] * 1.6));
  ctx.moveTo(...toPx(0, 0));
  ctx.lineTo(...toPx(third[0] * 1.6, third[1] * 1.6));
  ctx.stroke();

  // Batter's boxes (4 ft x 6 ft, 6 in from the plate).
  const boxW = 4;
  const boxL = 6;
  const gap = PLATE_HALF_WIDTH + 0.5;
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -gap - boxW : gap;
    const [px, py] = toPx(x0, -3 + PLATE_DEPTH / 2 - PLATE_DEPTH / 2);
    ctx.strokeRect(px, py, boxW * s, boxL * s);
  }
  // Catcher's box.
  ctx.beginPath();
  ctx.moveTo(...toPx(-PLATE_HALF_WIDTH - 0.5 - 4 + 0.0, 3));
  ctx.lineTo(...toPx(-1.8, 3));
  ctx.lineTo(...toPx(-1.8, 10));
  ctx.lineTo(...toPx(1.8, 10));
  ctx.lineTo(...toPx(1.8, 3));
  ctx.stroke();
}

function crowdTexture(maxAniso: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(2048, 1024);
  const rand = seededRandom(5);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  ctx.fillStyle = '#3a404c';
  ctx.fillRect(0, 0, c.width, c.height);
  const shirts = ['#f2f2f2', '#e6e6e6', '#1d3b72', '#27407a', '#c8342c', '#b3261e', '#f0c24a', '#6d8fbf', '#2c2c2c', '#8a2b2b', '#3f7a4f', '#d9d2c3', '#ffffff', '#1d3b72'];
  const skins = ['#f1c9a5', '#e0b48f', '#c68d62', '#a86f4c', '#8d5a3b', '#6b4430'];
  const hats = ['#1d3b72', '#1d3b72', '#b3261e', '#222', '#f2f2f2'];
  const rowH = 26;
  const seatW = 14;
  const aisleEvery = 22;
  for (let row = 0; row * rowH < c.height; row++) {
    const y = row * rowH;
    // Concrete step and seat backs.
    ctx.fillStyle = '#4a505c';
    ctx.fillRect(0, y + rowH - 6, c.width, 6);
    ctx.fillStyle = '#2a3346';
    ctx.fillRect(0, y + rowH - 12, c.width, 6);
    for (let k = 0; k * seatW < c.width; k++) {
      const x = k * seatW;
      if (k % aisleEvery === aisleEvery - 1) {
        ctx.fillStyle = '#6a707a';
        ctx.fillRect(x, y, seatW, rowH);
        continue;
      }
      if (rand() < 0.12) {
        // Empty seat.
        ctx.fillStyle = '#23407a';
        ctx.fillRect(x + 2, y + 9, seatW - 4, 10);
        continue;
      }
      const jitter = (rand() - 0.5) * 3;
      const cx = x + seatW / 2 + jitter;
      // Shoulders/torso with a little shading at the bottom.
      ctx.fillStyle = pick(shirts);
      ctx.beginPath();
      ctx.roundRect(cx - 5.5, y + 10, 11, 12, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(cx - 5.5, y + 18, 11, 4);
      // Head, sometimes with a cap.
      ctx.fillStyle = pick(skins);
      ctx.beginPath();
      ctx.arc(cx, y + 6.5 + (rand() - 0.5) * 2, 4, 0, Math.PI * 2);
      ctx.fill();
      if (rand() < 0.35) {
        ctx.fillStyle = pick(hats);
        ctx.beginPath();
        ctx.arc(cx, y + 5.5, 4.2, Math.PI, 0);
        ctx.fill();
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

/** Padded outfield wall: dark green panels with seams and a few ad boards (tiles every 240 ft). */
function wallTexture(maxAniso: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(2048, 96);
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, '#2f7550');
  g.addColorStop(0.12, '#255f41');
  g.addColorStop(1, '#1b4a32');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  const pxPerFt = c.width / 240;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let x = 0; x < c.width; x += 8 * pxPerFt) ctx.fillRect(x, 0, 2, c.height);
  const ads: Array<[string, string, string]> = [
    ['LEGACY', '#f5d33b', '#10151f'],
    ['BALLPARK FRANKS', '#ffffff', '#b3261e'],
    ['SEASON TICKETS', '#ffffff', '#1d3b72'],
    ['HIT IT HERE', '#10151f', '#f5d33b'],
  ];
  ads.forEach(([text, fg, bg], i) => {
    const x = (i * 60 + 12) * pxPerFt;
    const w = 36 * pxPerFt;
    ctx.fillStyle = bg;
    ctx.fillRect(x, 14, w, c.height - 28);
    ctx.fillStyle = fg;
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, c.height / 2 + 2, w - 16);
  });
  weather(c, 10, 0, 1, 3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

function wallAndStands(bounds: Array<[number, number]>, maxAniso: number): THREE.Group {
  const g = new THREE.Group();
  const n = bounds.length;
  // Outward normals (away from the field).
  const normals = bounds.map((_, i) => {
    const [x0, z0] = bounds[(i - 1 + n) % n];
    const [x1, z1] = bounds[(i + 1) % n];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    // For a boundary traversed LF pole -> fence -> RF pole -> backstop, the outside is to the left.
    return [-dz / len, dx / len] as [number, number];
  });
  // Make sure normals point away from the field center.
  const center: [number, number] = [0, -150];
  normals.forEach((nrm, i) => {
    const [x, z] = bounds[i];
    if ((x - center[0]) * nrm[0] + (z - center[1]) * nrm[1] < 0) {
      nrm[0] = -nrm[0];
      nrm[1] = -nrm[1];
    }
  });

  const wallPos: number[] = [];
  const wallUv: number[] = [];
  let wallU = 0;
  const standPos: number[] = [];
  const standUv: number[] = [];
  const standIdx: number[] = [];
  const wallIdx: number[] = [];
  const eyePos: number[] = [];
  const eyeIdx: number[] = [];
  let u = 0;
  for (let i = 0; i <= n; i++) {
    const [x, z] = bounds[i % n];
    const [nx, nz] = normals[i % n];
    const dist = Math.hypot(x, z);
    const isOutfield = dist > 250;
    const h = isOutfield ? WALL_HEIGHT : 6;
    if (i > 0) {
      const [px, pz] = bounds[(i - 1) % n];
      wallU += Math.hypot(x - px, z - pz) / 240;
    }
    wallPos.push(x, 0, z, x, h, z);
    wallUv.push(wallU, 0, wallU, 1);
    const depth = isOutfield ? 110 : 90;
    const rise = isOutfield ? 55 : 50;
    standPos.push(x + nx * 2, h, z + nz * 2, x + nx * depth, h + rise, z + nz * depth);
    if (i > 0) {
      const [px, pz] = bounds[(i - 1) % n];
      u += Math.hypot(x - px, z - pz) / 230;
    }
    standUv.push(u, 0, u, 1.25);
    if (i > 0) {
      const a = (i - 1) * 2;
      wallIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      const sprayAbs = Math.abs((Math.atan2(x, -z) * 180) / Math.PI);
      if (isOutfield && sprayAbs < 12) {
        // Batter's eye: a dark, crowd-free section in center field.
        const b = eyePos.length / 3;
        const [px, pz] = bounds[(i - 1) % n];
        const [pnx, pnz] = normals[(i - 1) % n];
        eyePos.push(px + pnx * 2, h, pz + pnz * 2, px + pnx * 60, h + 34, pz + pnz * 60);
        eyePos.push(x + nx * 2, h, z + nz * 2, x + nx * 60, h + 34, z + nz * 60);
        eyeIdx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      } else {
        standIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  }

  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
  wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wallUv, 2));
  wallGeo.setIndex(wallIdx);
  wallGeo.computeVertexNormals();
  const wall = new THREE.Mesh(
    wallGeo,
    new THREE.MeshStandardMaterial({ map: wallTexture(maxAniso), roughness: 0.85, side: THREE.DoubleSide }),
  );
  wall.receiveShadow = true;
  g.add(wall);

  // Yellow line on top of the outfield wall.
  const topPts: THREE.Vector3[] = [];
  for (let a = -FOUL_ANGLE; a <= FOUL_ANGLE + 1e-6; a += 3) {
    const [dx, dz] = sprayDir(a);
    const d = fenceDistance(a);
    topPts.push(new THREE.Vector3(dx * d, WALL_HEIGHT + 0.05, dz * d));
  }
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(topPts), new THREE.LineBasicMaterial({ color: '#f5d33b' })));

  const standGeo = new THREE.BufferGeometry();
  standGeo.setAttribute('position', new THREE.Float32BufferAttribute(standPos, 3));
  standGeo.setAttribute('uv', new THREE.Float32BufferAttribute(standUv, 2));
  standGeo.setIndex(standIdx);
  standGeo.computeVertexNormals();
  const stands = new THREE.Mesh(
    standGeo,
    new THREE.MeshStandardMaterial({ map: crowdTexture(maxAniso), roughness: 1, side: THREE.DoubleSide }),
  );
  g.add(stands);

  const eyeGeo = new THREE.BufferGeometry();
  eyeGeo.setAttribute('position', new THREE.Float32BufferAttribute(eyePos, 3));
  eyeGeo.setIndex(eyeIdx);
  eyeGeo.computeVertexNormals();
  g.add(new THREE.Mesh(eyeGeo, new THREE.MeshStandardMaterial({ color: '#16261c', roughness: 1, side: THREE.DoubleSide })));

  return g;
}

function base(x: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.25, 1.25), new THREE.MeshStandardMaterial({ color: '#fafafa' }));
  m.position.set(x, 0.12, z);
  m.rotation.y = Math.PI / 4;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function homePlate(): THREE.Mesh {
  const w = PLATE_HALF_WIDTH;
  const shape = new THREE.Shape();
  // Pentagon: flat front edge at z=0 (facing the pitcher), point toward the catcher.
  shape.moveTo(-w, 0);
  shape.lineTo(w, 0);
  shape.lineTo(w, 8.5 / 12);
  shape.lineTo(0, PLATE_DEPTH);
  shape.lineTo(-w, 8.5 / 12);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }));
  m.position.y = 0.06;
  m.receiveShadow = true;
  return m;
}

function mound(): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(3, 9, MOUND_HEIGHT, 32);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: DIRT, roughness: 1 }));
  m.position.set(0, MOUND_HEIGHT / 2, RUBBER_Z + 1.5);
  m.receiveShadow = true;
  g.add(m);
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(2, 0.05, 0.5), new THREE.MeshStandardMaterial({ color: '#ffffff' }));
  rubber.position.set(0, MOUND_HEIGHT + 0.02, RUBBER_Z);
  g.add(rubber);
  return g;
}

function foulPoles(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#f5d33b', emissive: '#3a3000' });
  for (const a of [-FOUL_ANGLE, FOUL_ANGLE]) {
    const [dx, dz] = sprayDir(a);
    const d = fenceDistance(a);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 80, 8), mat);
    pole.position.set(dx * d, 40, dz * d);
    g.add(pole);
  }
  return g;
}

function lightTowers(): THREE.Group {
  const g = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: '#5b6270' });
  const lampMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6d8', emissiveIntensity: 1.2 });
  for (const [x, z] of [
    [-330, -150],
    [330, -150],
    [-260, -420],
    [260, -420],
    [-200, 90],
    [200, 90],
  ]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.8, 150, 8), poleMat);
    pole.position.set(x, 75, z);
    g.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(28, 14, 3), lampMat);
    lamp.position.set(x, 155, z);
    lamp.lookAt(0, 0, -120);
    g.add(lamp);
  }
  return g;
}

function scoreboard(): THREE.Group {
  const g = new THREE.Group();
  const [c, ctx] = makeCanvas(512, 192);
  ctx.fillStyle = '#10151f';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#f5d33b';
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('BASEBALL', 256, 88);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('LEGACY', 256, 160);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 34),
    new THREE.MeshBasicMaterial({ map: tex }),
  );
  const [dx, dz] = sprayDir(28);
  const d = fenceDistance(28) + 95;
  board.position.set(dx * d, 95, dz * d);
  board.lookAt(0, 30, 0);
  g.add(board);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(96, 40, 3), new THREE.MeshStandardMaterial({ color: '#222831' }));
  frame.position.copy(board.position).addScaledVector(new THREE.Vector3(dx, 0, dz), 2);
  frame.lookAt(0, 30, 0);
  g.add(frame);
  return g;
}

/** Direction the sunlight comes from (toward the sun). */
const SUN_DIR = new THREE.Vector3(-120, 220, 170).normalize();

const SKY_GAIN = 0.5;

/** Physically based daytime sky with a few clouds. */
function sky(): Sky {
  const sky = new Sky();
  sky.scale.setScalar(6000);
  const u = sky.material.uniforms;
  u.turbidity.value = 4;
  u.rayleigh.value = 1.2;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(SUN_DIR);
  u.cloudCoverage.value = 0.32;
  u.cloudDensity.value = 0.35;
  u.showSunDisc.value = 0;
  // The physical sky is far brighter than the scene's other lights; tone it down.
  sky.material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'gl_FragColor = vec4( texColor, 1.0 );',
      `gl_FragColor = vec4( texColor * ${SKY_GAIN.toFixed(2)}, 1.0 );`,
    );
  };
  return sky;
}

/** Image-based lighting from the sky (and a grass-colored ground) for soft, realistic shading. */
function skyEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const envScene = new THREE.Scene();
  envScene.add(sky());
  const ground = new THREE.Mesh(new THREE.CircleGeometry(5000, 16), new THREE.MeshBasicMaterial({ color: '#2f5a2a' }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -20;
  envScene.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0, 1, 20000).texture;
  pmrem.dispose();
  return env;
}

/** Build the ballpark into `scene` (including its sky lighting). */
export function buildStadium(renderer: THREE.WebGLRenderer, scene: THREE.Scene): THREE.Group {
  const g = new THREE.Group();
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const bounds = stadiumBoundary();
  const bump = detailBump(aniso);

  const outer: GroundRegion = { xmin: -340, xmax: 340, zmin: -480, zmax: 120, ppf: 2 };
  g.add(groundPlane(outer, groundTexture(outer, drawField, aniso), 0, false, bump));

  const inner: GroundRegion = { xmin: -128, xmax: 128, zmin: -170, zmax: 30, ppf: 8 };
  g.add(groundPlane(inner, groundTexture(inner, drawInfield, aniso), 0.02, true, bump));

  // Big ground skirt beyond the stands so there are no gaps at the horizon.
  const skirt = new THREE.Mesh(new THREE.CircleGeometry(2500, 32), new THREE.MeshStandardMaterial({ color: '#2d3a2c' }));
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.y = -0.2;
  g.add(skirt);

  g.add(wallAndStands(bounds, aniso));
  g.add(homePlate());
  g.add(mound());
  const r2 = Math.SQRT1_2;
  g.add(base(BASE_DISTANCE * r2, -BASE_DISTANCE * r2));
  g.add(base(0, -BASE_DISTANCE * Math.SQRT2));
  g.add(base(-BASE_DISTANCE * r2, -BASE_DISTANCE * r2));
  g.add(foulPoles());
  g.add(lightTowers());
  g.add(scoreboard());
  g.add(sky());

  // Lighting: warm sun, sky-based ambient light and a little hemisphere fill.
  scene.environment = skyEnvironment(renderer);
  scene.environmentIntensity = 0.5;
  const hemi = new THREE.HemisphereLight('#d6e8ff', '#3a5a2a', 0.35);
  g.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1d6', 2.6);
  sun.position.copy(SUN_DIR).multiplyScalar(280).add(new THREE.Vector3(0, 0, -30));
  sun.target.position.set(0, 0, -30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -90;
  sc.right = 90;
  sc.top = 90;
  sc.bottom = -90;
  sc.near = 50;
  sc.far = 600;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  g.add(sun, sun.target);

  scene.add(g);
  return g;
}
