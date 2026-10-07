import * as THREE from 'three';
import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js';

/**
 * One smooth, continuous body for a player (torso, hips, arms to the wrists, legs to the
 * ankles, neck), skinned to a 10-bone skeleton. The shape is a smooth union of rounded
 * primitives (a signed distance field), meshed once per build with marching cubes.
 */

export const BONE_NAMES = ['pelvis', 'chest', 'upperR', 'upperL', 'foreR', 'foreL', 'thighR', 'thighL', 'shinR', 'shinL'] as const;
export type BoneName = (typeof BONE_NAMES)[number];
const B = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as Record<BoneName, number>;

export interface BindJoints {
  pelvis: THREE.Vector3;
  chest: THREE.Vector3;
  shoulder: { R: THREE.Vector3; L: THREE.Vector3 };
  elbow: { R: THREE.Vector3; L: THREE.Vector3 };
  wrist: { R: THREE.Vector3; L: THREE.Vector3 };
  hip: { R: THREE.Vector3; L: THREE.Vector3 };
  knee: { R: THREE.Vector3; L: THREE.Vector3 };
  ankle: { R: THREE.Vector3; L: THREE.Vector3 };
}

export interface BodyData {
  geometry: THREE.BufferGeometry;
}

type SDF = (x: number, y: number, z: number) => number;

interface Prim {
  bone: number;
  f: SDF;
  min: THREE.Vector3;
  max: THREE.Vector3;
}

const SMOOTH = 0.07;

function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Inigo Quilez's round cone: a capsule tapering from radius r1 at a to r2 at b. */
function roundCone(a: THREE.Vector3, b: THREE.Vector3, r1: number, r2: number): SDF {
  const bx = b.x - a.x;
  const by = b.y - a.y;
  const bz = b.z - a.z;
  const l2 = bx * bx + by * by + bz * bz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  return (x, y, z) => {
    const px = x - a.x;
    const py = y - a.y;
    const pz = z - a.z;
    const yy = px * bx + py * by + pz * bz;
    const zz = yy - l2;
    const qx = px * l2 - bx * yy;
    const qy = py * l2 - by * yy;
    const qz = pz * l2 - bz * yy;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yy * yy * l2;
    const z2 = zz * zz * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  };
}

/** Approximate ellipsoid distance. */
function ellipsoid(c: THREE.Vector3, r: THREE.Vector3): SDF {
  return (x, y, z) => {
    const px = (x - c.x) / r.x;
    const py = (y - c.y) / r.y;
    const pz = (z - c.z) / r.z;
    const k0 = Math.sqrt(px * px + py * py + pz * pz);
    const k1 = Math.sqrt((px / r.x) ** 2 + (py / r.y) ** 2 + (pz / r.z) ** 2);
    return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(r.x, r.y, r.z);
  };
}

/** Torso: an elliptical lathe (narrow waist, broad chest, sloping shoulders). y is chest-space. */
function torso(chest: THREE.Vector3, bw: number): SDF {
  const prof: Array<[number, number]> = [
    [-0.12, 0.5],
    [0.15, 0.5],
    [0.4, 0.53],
    [0.8, 0.6],
    [1.2, 0.72],
    [1.45, 0.78],
    [1.62, 0.75],
    [1.76, 0.6],
    [1.86, 0.34],
    [1.9, 0.0],
  ];
  const r = (ly: number): number => {
    if (ly <= prof[0][0]) return prof[0][1];
    for (let i = 1; i < prof.length; i++) {
      if (ly <= prof[i][0]) {
        const [y0, r0] = prof[i - 1];
        const [y1, r1] = prof[i];
        const t = (ly - y0) / (y1 - y0);
        const s = t * t * (3 - 2 * t);
        return r0 + (r1 - r0) * s;
      }
    }
    return 0;
  };
  const sx = bw;
  const sz = 0.62 * bw;
  return (x, y, z) => {
    const ly = y - chest.y;
    const q = Math.sqrt((x / sx) ** 2 + (z / sz) ** 2);
    const d = (q - r(ly)) * sz;
    return Math.max(d, prof[0][0] - ly, ly - 1.9);
  };
}

function prim(bone: number, f: SDF, min: THREE.Vector3, max: THREE.Vector3): Prim {
  return { bone, f, min: min.clone().subScalar(SMOOTH + 0.05), max: max.clone().addScalar(SMOOTH + 0.05) };
}

function capsuleBox(a: THREE.Vector3, b: THREE.Vector3, r: number): [THREE.Vector3, THREE.Vector3] {
  return [new THREE.Vector3(Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.min(a.z, b.z) - r), new THREE.Vector3(Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, Math.max(a.z, b.z) + r)];
}

function buildPrims(j: BindJoints, bw: number, lw: number): Prim[] {
  const P: Prim[] = [];
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const cone = (bone: number, a: THREE.Vector3, b: THREE.Vector3, r1: number, r2: number) => {
    const [mn, mx] = capsuleBox(a, b, Math.max(r1, r2));
    P.push(prim(bone, roundCone(a, b, r1, r2), mn, mx));
  };
  const ell = (bone: number, c: THREE.Vector3, r: THREE.Vector3) => {
    P.push(prim(bone, ellipsoid(c, r), c.clone().sub(r), c.clone().add(r)));
  };
  const pc = j.pelvis;
  const cc = j.chest;
  // Pelvis: hips and glutes.
  ell(B.pelvis, v(0, pc.y + 0.12, 0), v(0.5 * bw, 0.32, 0.32 * bw));
  for (const s of [-1, 1]) ell(B.pelvis, v(s * 0.2 * bw, pc.y + 0.0, -0.13 * bw), v(0.24 * bw, 0.27, 0.2 * bw));
  // Chest: torso, pecs, trapezius, neck.
  P.push(prim(B.chest, torso(cc, bw), v(-0.8 * bw, cc.y - 0.15, -0.5 * bw), v(0.8 * bw, cc.y + 1.95, 0.5 * bw)));
  for (const s of [-1, 1]) ell(B.chest, v(s * 0.25 * bw, cc.y + 1.3, 0.3 * bw), v(0.26 * bw, 0.17, 0.16 * bw));
  for (const side of ['R', 'L'] as const) {
    const sh = j.shoulder[side];
    cone(B.chest, v(0, cc.y + 1.76, -0.08), v(sh.x * 0.8, sh.y + 0.1, -0.04), 0.2, 0.13);
  }
  cone(B.chest, v(0, cc.y + 1.7, -0.02), v(0, cc.y + 2.12, 0.0), 0.21, 0.175);
  // Arms and legs.
  for (const side of ['R', 'L'] as const) {
    const out = side === 'R' ? -1 : 1;
    const upper = side === 'R' ? B.upperR : B.upperL;
    const fore = side === 'R' ? B.foreR : B.foreL;
    const thigh = side === 'R' ? B.thighR : B.thighL;
    const shin = side === 'R' ? B.shinR : B.shinL;
    const sh = j.shoulder[side];
    const el = j.elbow[side];
    const wr = j.wrist[side];
    const ua = el.clone().sub(sh);
    const fa = wr.clone().sub(el);
    // Deltoid, biceps, forearm.
    ell(upper, sh.clone().add(v(out * 0.06, 0.02, 0)), v(0.25 * lw, 0.27 * lw, 0.235 * lw));
    const bic = sh.clone().addScaledVector(ua, 0.45);
    cone(upper, sh, bic, 0.2 * lw, 0.175 * lw);
    cone(upper, bic, el, 0.175 * lw, 0.13 * lw);
    const fm = el.clone().addScaledVector(fa, 0.28);
    cone(fore, el, fm, 0.13 * lw, 0.145 * lw);
    cone(fore, fm, wr, 0.145 * lw, 0.09 * lw);
    // Quads, knee, calf.
    const hp = j.hip[side];
    const kn = j.knee[side];
    const an = j.ankle[side];
    const th = kn.clone().sub(hp);
    const sn = an.clone().sub(kn);
    const tq = hp.clone().addScaledVector(th, 0.32);
    // Baseball pants are roomy through the thigh and knee.
    cone(thigh, hp, tq, 0.31 * lw, 0.295 * lw);
    cone(thigh, tq, kn, 0.295 * lw, 0.21 * lw);
    const calf = kn.clone().addScaledVector(sn, 0.3).add(v(0, 0, -0.04));
    cone(shin, kn, calf, 0.21 * lw, 0.19 * lw);
    cone(shin, calf, an, 0.19 * lw, 0.115 * lw);
  }
  return P;
}

function evalPrims(P: Prim[], x: number, y: number, z: number): number {
  let d = 1e9;
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    if (x < p.min.x || y < p.min.y || z < p.min.z || x > p.max.x || y > p.max.y || z > p.max.z) continue;
    d = smin(d, p.f(x, y, z), SMOOTH);
  }
  return d;
}

// Bourke's corner offsets and the corners each edge joins.
const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
const EDGES = [
  [0, 1],
  [1, 2],
  [3, 2],
  [0, 3],
  [4, 5],
  [5, 6],
  [7, 6],
  [4, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

const cache = new Map<string, BodyData>();

/** The body for a build (cached: every player with the same build shares the geometry). */
export function bodyFor(key: string, joints: BindJoints, bw: number, lw: number, step = 0.04): BodyData {
  const hit = cache.get(key);
  if (hit) return hit;
  const P = buildPrims(joints, bw, lw);
  const f = (x: number, y: number, z: number) => evalPrims(P, x, y, z);

  // Grid over the body's bounds.
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of P) {
    min.min(p.min);
    max.max(p.max);
  }
  const nx = Math.ceil((max.x - min.x) / step) + 1;
  const ny = Math.ceil((max.y - min.y) / step) + 1;
  const nz = Math.ceil((max.z - min.z) / step) + 1;
  const field = new Float32Array(nx * ny * nz);
  const idx = (ix: number, iy: number, iz: number) => ix + iy * nx + iz * nx * ny;
  for (let iz = 0; iz < nz; iz++) {
    const z = min.z + iz * step;
    for (let iy = 0; iy < ny; iy++) {
      const y = min.y + iy * step;
      for (let ix = 0; ix < nx; ix++) field[idx(ix, iy, iz)] = f(min.x + ix * step, y, z);
    }
  }

  // Marching cubes, sharing a vertex per crossed grid edge.
  const edgeVert = new Int32Array(nx * ny * nz * 3).fill(-1);
  const pos: number[] = [];
  const tris: number[] = [];
  const vertOnEdge = (ix: number, iy: number, iz: number, e: number): number => {
    const [c1, c2] = EDGES[e];
    const a = CORNERS[c1];
    const b = CORNERS[c2];
    const ax = ix + a[0];
    const ay = iy + a[1];
    const az = iz + a[2];
    const axis = b[0] !== a[0] ? 0 : b[1] !== a[1] ? 1 : 2;
    const key = idx(ax, ay, az) * 3 + axis;
    if (edgeVert[key] >= 0) return edgeVert[key];
    const f1 = field[idx(ax, ay, az)];
    const f2 = field[idx(ix + b[0], iy + b[1], iz + b[2])];
    const t = f1 / (f1 - f2);
    const vi = pos.length / 3;
    pos.push(min.x + (ax + (axis === 0 ? t : 0)) * step, min.y + (ay + (axis === 1 ? t : 0)) * step, min.z + (az + (axis === 2 ? t : 0)) * step);
    edgeVert[key] = vi;
    return vi;
  };
  const cv = new Float32Array(8);
  for (let iz = 0; iz < nz - 1; iz++) {
    for (let iy = 0; iy < ny - 1; iy++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        let ci = 0;
        for (let c = 0; c < 8; c++) {
          const o = CORNERS[c];
          cv[c] = field[idx(ix + o[0], iy + o[1], iz + o[2])];
          if (cv[c] < 0) ci |= 1 << c;
        }
        if (edgeTable[ci] === 0) continue;
        const base = ci * 16;
        for (let t = 0; triTable[base + t] !== -1; t += 3) {
          tris.push(vertOnEdge(ix, iy, iz, triTable[base + t]), vertOnEdge(ix, iy, iz, triTable[base + t + 1]), vertOnEdge(ix, iy, iz, triTable[base + t + 2]));
        }
      }
    }
  }

  // Smooth normals from the field's gradient; skin weights from the nearest primitives.
  const n = pos.length / 3;
  const normals = new Float32Array(n * 3);
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const limbS = new Float32Array(n * 2);
  const e = 0.01;
  const p = new THREE.Vector3();
  const boneD = new Float32Array(BONE_NAMES.length);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const gx = f(x + e, y, z) - f(x - e, y, z);
    const gy = f(x, y + e, z) - f(x, y - e, z);
    const gz = f(x, y, z + e) - f(x, y, z - e);
    const gl = Math.hypot(gx, gy, gz) || 1;
    normals[i * 3] = gx / gl;
    normals[i * 3 + 1] = gy / gl;
    normals[i * 3 + 2] = gz / gl;

    boneD.fill(1e9);
    for (const pr of P) boneD[pr.bone] = Math.min(boneD[pr.bone], pr.f(x, y, z));
    const order = Array.from(boneD.keys()).sort((a, b) => boneD[a] - boneD[b]);
    const dmin = boneD[order[0]];
    let sum = 0;
    const w: number[] = [];
    for (let k = 0; k < 4; k++) {
      const wk = Math.exp(-(boneD[order[k]] - dmin) / 0.045);
      w.push(wk < 0.02 ? 0 : wk);
      sum += w[k];
    }
    for (let k = 0; k < 4; k++) {
      skinIndex[i * 4 + k] = order[k];
      skinWeight[i * 4 + k] = w[k] / sum;
    }
    p.set(x, y, z);
    // Distance down the arm (from the shoulder) or the leg (from the hip); -1 elsewhere.
    const along = (a: THREE.Vector3, b: THREE.Vector3) => {
      const ab = b.clone().sub(a);
      const L = ab.length();
      return Math.max(0, Math.min(L, p.clone().sub(a).dot(ab) / L));
    };
    const top = order[0];
    const sideOf = (r: number, l: number) => (top === r ? 'R' : top === l ? 'L' : null);
    const ua = sideOf(B.upperR, B.upperL);
    const fa = sideOf(B.foreR, B.foreL);
    const th = sideOf(B.thighR, B.thighL);
    const sh = sideOf(B.shinR, B.shinL);
    limbS[i * 2] = ua ? along(joints.shoulder[ua], joints.elbow[ua]) : fa ? joints.shoulder[fa].distanceTo(joints.elbow[fa]) + along(joints.elbow[fa], joints.wrist[fa]) : -1;
    limbS[i * 2 + 1] = th ? along(joints.hip[th], joints.knee[th]) : sh ? joints.hip[sh].distanceTo(joints.knee[sh]) + along(joints.knee[sh], joints.ankle[sh]) : -1;
  }

  // Orient triangles outward.
  const index: number[] = [];
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  for (let t = 0; t < tris.length; t += 3) {
    let [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
    if (a === b || b === c || a === c) continue;
    va.fromArray(pos, a * 3);
    vb.fromArray(pos, b * 3);
    vc.fromArray(pos, c * 3);
    const fn = vb.sub(va).cross(vc.sub(va));
    const nsx = normals[a * 3] + normals[b * 3] + normals[c * 3];
    const nsy = normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c * 3 + 1];
    const nsz = normals[a * 3 + 2] + normals[b * 3 + 2] + normals[c * 3 + 2];
    if (fn.x * nsx + fn.y * nsy + fn.z * nsz < 0) [b, c] = [c, b];
    index.push(a, b, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('limbS', new THREE.BufferAttribute(limbS, 2));
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  const data = { geometry: geo };
  cache.set(key, data);
  return data;
}

/**
 * Cloth for the body: team colour with procedural pinstripes and (for the jersey) a
 * button placket with piping. Drawn from the body's rest-pose position, so it needs no UVs
 * and moves with the cloth. `local` = stripes run around the mesh's own Y axis (sleeves).
 */
export function clothShader(m: THREE.MeshPhysicalMaterial, opts: { stripes: boolean; stripeColor: string; placket: boolean; local?: boolean; chestY?: number }): void {
  const uniforms = {
    uStripeColor: { value: new THREE.Color(opts.stripeColor) },
    uStripes: { value: opts.stripes ? 1 : 0 },
    uPlacket: { value: opts.placket ? 1 : 0 },
    uLocal: { value: opts.local ? 1 : 0 },
    uChestY: { value: opts.chestY ?? 3.35 },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBody;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBody = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBody;\nuniform vec3 uStripeColor;\nuniform float uStripes;\nuniform float uPlacket;\nuniform float uLocal;\nuniform float uChestY;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 p = vBody;
          bool body = uLocal > 0.5 || p.y > uChestY - 0.4;
          vec2 c = (uLocal > 0.5 || body) ? vec2(0.0) : vec2(sign(p.x) * 0.34, 0.0);
          float R = body ? 0.62 : 0.26;
          float s = atan(p.x - c.x, p.z - c.y) * R / 0.11;
          float w = fwidth(s);
          float d0 = abs(fract(s + 0.5) - 0.5);
          float line = 1.0 - smoothstep(0.07 - w, 0.07 + w, d0);
          float far = clamp(w * 2.5 - 0.5, 0.0, 1.0);
          float stripe = mix(line, 0.14, far) * uStripes;
          diffuseColor.rgb = mix(diffuseColor.rgb, uStripeColor, stripe * 0.8);
          if (uPlacket > 0.5 && p.z > 0.0 && p.y > uChestY + 0.1 && p.y < uChestY + 1.78) {
            float ax = abs(p.x);
            if (ax < 0.055) diffuseColor.rgb *= 0.95;
            if (ax > 0.045 && ax < 0.058) diffuseColor.rgb = mix(diffuseColor.rgb, uStripeColor, 0.9);
            for (int i = 0; i < 6; i++) {
              float by = uChestY + 0.25 + float(i) * 0.27;
              if (length(vec2(p.x, p.y - by)) < 0.026) diffuseColor.rgb = vec3(0.93, 0.92, 0.88);
            }
          }
          // Soft folds where the cloth bunches (waist, behind the knee, the elbow crease).
          float fold = 0.5 + 0.5 * sin(p.y * 38.0 + sin(p.x * 9.0) * 2.0);
          diffuseColor.rgb *= 1.0 - 0.035 * fold;
        }`,
      );
  };
  m.customProgramCacheKey = () => `cloth|${opts.local ? 1 : 0}`;
}

export interface BodyLook {
  jersey: string;
  pants: string;
  /** Socks and the undershirt sleeves. */
  accent: string;
  skin: string;
  stripes: boolean;
}

/**
 * The whole body in one material: jersey, pants, stirrup socks, undershirt sleeves and
 * bare skin, chosen per pixel from where it is on the body (so hems are clean lines),
 * with pinstripes, a button placket and soft folds on the cloth.
 */
export function bodyMaterial(look: BodyLook, j: BindJoints): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.84, sheen: 0.45, sheenRoughness: 0.75, sheenColor: new THREE.Color('#ffffff') });
  const upperLen = j.shoulder.R.distanceTo(j.elbow.R);
  const thighLen = j.hip.R.distanceTo(j.knee.R);
  const uniforms = {
    uJersey: { value: new THREE.Color(look.jersey) },
    uPants: { value: new THREE.Color(look.pants) },
    uAccent: { value: new THREE.Color(look.accent) },
    uSkin: { value: new THREE.Color(look.skin) },
    uStripes: { value: look.stripes ? 1 : 0 },
    uChestY: { value: j.chest.y },
    uPelvisY: { value: j.pelvis.y },
    uSleeveEnd: { value: upperLen + 0.35 },
    uSockStart: { value: thighLen + 0.6 },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 limbS;\nvarying vec3 vBody;\nvarying vec2 vLimb;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBody = position;\nvLimb = limbS;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vBody;
        varying vec2 vLimb;
        uniform vec3 uJersey, uPants, uAccent, uSkin;
        uniform float uStripes, uChestY, uPelvisY, uSleeveEnd, uSockStart;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float skinAmt = 0.0;
        {
          vec3 p = vBody;
          // 0 jersey, 1 pants, 2 accent (socks, undershirt), 3 skin.
          float region;
          bool onLeg = false;
          if (vLimb.x >= 0.0) {
            // Jersey sleeve (covered by the sleeve tube), undershirt to the forearm, then skin.
            region = vLimb.x < 0.5 ? 0.0 : (vLimb.x < uSleeveEnd ? 2.0 : 3.0);
          } else if (vLimb.y >= 0.0) {
            region = vLimb.y < uSockStart ? 1.0 : 2.0;
            onLeg = true;
          } else {
            region = p.y > uChestY + 1.82 ? 3.0 : (p.y < uPelvisY + 0.3 ? 1.0 : 0.0);
          }
          vec3 col = region < 0.5 ? uJersey : region < 1.5 ? uPants : region < 2.5 ? uAccent : uSkin;
          skinAmt = region > 2.5 ? 1.0 : 0.0;
          if (region < 1.5) {
            // Pinstripes around the body, or around each leg below the hips.
            bool leg = onLeg && p.y < uPelvisY - 0.15;
            vec2 c = leg ? vec2(sign(p.x) * 0.34, 0.0) : vec2(0.0);
            float R = leg ? 0.28 : 0.62;
            float s = atan(p.x - c.x, p.z - c.y) * R / 0.11;
            float w = fwidth(s);
            float d0 = abs(fract(s + 0.5) - 0.5);
            float line = 1.0 - smoothstep(0.07 - w, 0.07 + w, d0);
            float far = clamp(w * 2.5 - 0.5, 0.0, 1.0);
            col = mix(col, uAccent, mix(line, 0.14, far) * uStripes * 0.8);
            if (region < 0.5 && p.z > 0.0 && p.y > uChestY + 0.1 && p.y < uChestY + 1.78) {
              // Button placket with piping down the front.
              float ax = abs(p.x);
              if (ax < 0.055) col *= 0.95;
              if (ax > 0.045 && ax < 0.058) col = mix(col, uAccent, 0.9);
              for (int i = 0; i < 6; i++) {
                float by = uChestY + 0.25 + float(i) * 0.27;
                if (length(vec2(p.x, p.y - by)) < 0.026) col = vec3(0.93, 0.92, 0.88);
              }
            }
            // Soft folds in the cloth.
            float fold = 0.5 + 0.5 * sin(p.y * 31.0 + sin(p.x * 7.0 + p.z * 5.0) * 2.4);
            col *= 1.0 - 0.05 * fold;
          }
          diffuseColor.rgb = col;
        }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.55, skinAmt);');
  };
  m.customProgramCacheKey = () => 'body';
  return m;
}
