import * as THREE from 'three';
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

function groundPlane(region: GroundRegion, tex: THREE.Texture, y: number, transparent: boolean): THREE.Mesh {
  const w = region.xmax - region.xmin;
  const h = region.zmax - region.zmin;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, transparent, depthWrite: !transparent }),
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
  const [c, ctx] = makeCanvas(1024, 512);
  ctx.fillStyle = '#2b2f3a';
  ctx.fillRect(0, 0, c.width, c.height);
  const colors = ['#e8e8e8', '#c8342c', '#27407a', '#f0c24a', '#6d8fbf', '#f2f2f2', '#8a2b2b', '#1e1e1e', '#d9a47c', '#6b4a33'];
  const rowH = 16;
  for (let row = 0; row < c.height / rowH; row++) {
    ctx.fillStyle = row % 2 ? '#343947' : '#3a3f4d';
    ctx.fillRect(0, row * rowH + rowH - 4, c.width, 4);
    for (let x = 0; x < c.width; x += 7) {
      if (Math.random() < 0.18) continue;
      ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
      ctx.fillRect(x + Math.random() * 2, row * rowH + 3 + Math.random() * 2, 5, 8);
      ctx.fillStyle = Math.random() < 0.5 ? '#d9a47c' : '#8a5a3c';
      ctx.fillRect(x + 1 + Math.random() * 2, row * rowH, 3, 3);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
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
    wallPos.push(x, 0, z, x, h, z);
    const depth = isOutfield ? 110 : 90;
    const rise = isOutfield ? 55 : 50;
    standPos.push(x + nx * 2, h, z + nz * 2, x + nx * depth, h + rise, z + nz * depth);
    if (i > 0) {
      const [px, pz] = bounds[(i - 1) % n];
      u += Math.hypot(x - px, z - pz) / 60;
    }
    standUv.push(u, 0, u, 3);
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
  wallGeo.setIndex(wallIdx);
  wallGeo.computeVertexNormals();
  const wall = new THREE.Mesh(
    wallGeo,
    new THREE.MeshStandardMaterial({ color: '#2e6b48', emissive: '#12301f', roughness: 0.9, side: THREE.DoubleSide }),
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

function sky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(3000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color('#3f7fd4') },
      horizon: { value: new THREE.Color('#cfe3f5') },
    },
    vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vPos;
      void main(){ float h = clamp(normalize(vPos).y, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.55)), 1.0); }`,
  });
  return new THREE.Mesh(geo, mat);
}

export function buildStadium(renderer: THREE.WebGLRenderer): THREE.Group {
  const g = new THREE.Group();
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const bounds = stadiumBoundary();

  const outer: GroundRegion = { xmin: -340, xmax: 340, zmin: -480, zmax: 120, ppf: 2 };
  g.add(groundPlane(outer, groundTexture(outer, drawField, aniso), 0, false));

  const inner: GroundRegion = { xmin: -128, xmax: 128, zmin: -170, zmax: 30, ppf: 8 };
  g.add(groundPlane(inner, groundTexture(inner, drawInfield, aniso), 0.02, true));

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

  // Lighting: warm sun + sky fill.
  const hemi = new THREE.HemisphereLight('#d6e8ff', '#3a5a2a', 1.1);
  g.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
  sun.position.set(-120, 220, 140);
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
  g.add(sun, sun.target);

  return g;
}
