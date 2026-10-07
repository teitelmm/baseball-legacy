import * as THREE from 'three';
import { BONE_NAMES, bodyFor, bodyMaterial, clothShader, type BindJoints } from './bodyMesh';

/** [x, y, z] in the model's root space. The model faces +z; its right side is -x. */
export type P3 = [number, number, number];

export interface BatPose {
  /** Knob/handle position. */
  h: P3;
  /** Direction of the bat from handle to barrel, as yaw/pitch in degrees. yaw 0 = +x, 90 = +z. */
  yaw: number;
  pitch: number;
}

export interface Pose {
  pelvis: P3;
  /** Euler rotation of the pelvis in radians (x, y, z). */
  pelvisRot: P3;
  chestRot: P3;
  handR: P3;
  handL: P3;
  footR: P3;
  footL: P3;
  /** Foot yaw (radians) so feet can point sideways. */
  footYawR?: number;
  footYawL?: number;
  bat?: BatPose;
  /** Head turn relative to the chest (x nod, y turn, z tilt), e.g. to keep eyes on the ball. */
  headRot?: P3;
}

export interface Appearance {
  jersey: string;
  pants: string;
  skin: string;
  cap: string;
  /** Sleeves, socks and lettering. */
  undershirt?: string;
  gloveHand?: 'L' | 'R' | null;
  /** Height in inches (default 73 = 6'1"). */
  heightIn?: number;
  build?: 'slim' | 'athletic' | 'stocky';
  hair?: 'none' | 'buzz' | 'short' | 'long' | 'curly';
  hairColor?: string;
  facialHair?: 'none' | 'stubble' | 'mustache' | 'goatee' | 'beard';
  eyeBlack?: boolean;
  number?: number;
  backName?: string;
  batColor?: string;
  gloveColor?: string;
  /** Team pinstripes on the jersey and pants. */
  pinstripes?: boolean;
  /** One or two letters on the front of the cap. */
  logo?: string;
}

const BASE_HEIGHT_IN = 73;

function frontNumberTexture(number: number, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 96px sans-serif';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.fillStyle = color;
  ctx.strokeText(String(number), 64, 70);
  ctx.fillText(String(number), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function backPlateTexture(name: string | undefined, number: number, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 6;
  if (name) {
    ctx.font = 'bold 38px sans-serif';
    ctx.fillText(name.toUpperCase().slice(0, 12), 128, 58);
  }
  ctx.font = 'bold 150px sans-serif';
  ctx.strokeText(String(number), 128, name ? 212 : 190);
  ctx.fillText(String(number), 128, name ? 212 : 190);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export type Keyframes = Array<[number, Pose]>;

// ---------------------------------------------------------------------------
// Fabric, cap and skin materials (textures are shared between players)

const texCache = new Map<string, THREE.Texture>();

function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = texCache.get(key);
  if (!t) {
    t = make();
    texCache.set(key, t);
  }
  return t;
}

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  return `#${c.multiplyScalar(k).getHexString()}`;
}

/** Six-panel cap: seams radiating from the button (one down the front centre) and a darker eyelet row. */
function capTexture(color: string): THREE.Texture {
  return cached(`cap|${color}`, () => {
    const W = 768;
    const H = 256;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = shade(color, 0.7);
    ctx.lineWidth = 3;
    // The sphere's front is at u = 0.25; seams every sixth of the way round, one on the front centre.
    for (let k = 0; k < 6; k++) {
      const x = ((0.25 + k / 6) % 1) * W;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    // Slight sheen toward the crown.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(255,255,255,0.12)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    return t;
  });
}

function logoTexture(text: string, color: string): THREE.Texture {
  return cached(`logo|${text}|${color}`, () => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${text.length > 1 ? 70 : 96}px serif`;
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.fillStyle = color;
    ctx.strokeText(text, 64, 68);
    ctx.fillText(text, 64, 68);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

function skinMaterial(color: string): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.58, sheen: 0.3, sheenRoughness: 0.55, sheenColor: new THREE.Color(shade(color, 1.15)) });
}

/** Eye colour from the skin tone, varied a little so teammates don't all match. */
function irisColor(skin: string, salt: number): string {
  const c = new THREE.Color(skin);
  const light = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
  const pool = light > 0.72 ? ['#4a6fa5', '#3b7a57', '#6b4a2a', '#5a7a8c'] : light > 0.55 ? ['#5a3a1e', '#3b7a57', '#6b4a2a', '#2d2a26'] : ['#3a2415', '#2d2a26', '#4a2e1a'];
  return pool[salt % pool.length];
}

let blobTex: THREE.CanvasTexture | null = null;
/** Soft dark spot for the contact shadow under a player's feet. */
function blobTexture(): THREE.CanvasTexture {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.4)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

const UP = new THREE.Vector3(0, 1, 0);
const THIGH = 1.55;
const SHIN = 1.5;
const UPPER_ARM = 1.08;
const FOREARM = 1.02;
const SHOULDER_R = new THREE.Vector3(-0.74, 1.5, 0);
const SHOULDER_L = new THREE.Vector3(0.74, 1.5, 0);
const HIP_R = new THREE.Vector3(-0.34, -0.05, 0);
const HIP_L = new THREE.Vector3(0.34, -0.05, 0);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: P3, b: P3, t: number): P3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = (t: number) => t * t * (3 - 2 * t);

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const p: Pose = {
    pelvis: lerp3(a.pelvis, b.pelvis, t),
    pelvisRot: lerp3(a.pelvisRot, b.pelvisRot, t),
    chestRot: lerp3(a.chestRot, b.chestRot, t),
    handR: lerp3(a.handR, b.handR, t),
    handL: lerp3(a.handL, b.handL, t),
    footR: lerp3(a.footR, b.footR, t),
    footL: lerp3(a.footL, b.footL, t),
    footYawR: lerp(a.footYawR ?? 0, b.footYawR ?? 0, t),
    footYawL: lerp(a.footYawL ?? 0, b.footYawL ?? 0, t),
  };
  if (a.bat && b.bat) {
    p.bat = { h: lerp3(a.bat.h, b.bat.h, t), yaw: lerp(a.bat.yaw, b.bat.yaw, t), pitch: lerp(a.bat.pitch, b.bat.pitch, t) };
  }
  if (a.headRot || b.headRot) p.headRot = lerp3(a.headRot ?? [0, 0, 0], b.headRot ?? [0, 0, 0], t);
  return p;
}

/** A pose as a flat list of numbers (and back), for smooth curves through keyframes. */
function flatten(p: Pose): number[] {
  const bat = p.bat ?? { h: [0, 0, 0], yaw: 0, pitch: 0 };
  return [
    ...p.pelvis, ...p.pelvisRot, ...p.chestRot, ...p.handR, ...p.handL, ...p.footR, ...p.footL,
    p.footYawR ?? 0, p.footYawL ?? 0, ...bat.h, bat.yaw, bat.pitch, ...(p.headRot ?? [0, 0, 0]),
  ];
}

function unflatten(v: number[], like: Pose): Pose {
  const t3 = (i: number): P3 => [v[i], v[i + 1], v[i + 2]];
  const p: Pose = {
    pelvis: t3(0), pelvisRot: t3(3), chestRot: t3(6), handR: t3(9), handL: t3(12), footR: t3(15), footL: t3(18),
    footYawR: v[21], footYawL: v[22], headRot: t3(28),
  };
  if (like.bat) p.bat = { h: t3(23), yaw: v[26], pitch: v[27] };
  return p;
}

/**
 * Sample keyframes at time t. Motion flows through the keys on a smooth curve (cubic
 * Hermite with Catmull-Rom tangents), easing in and out only at the ends and at holds,
 * instead of stopping at every key.
 */
export function samplePose(keys: Keyframes, t: number): Pose {
  if (t <= keys[0][0]) return keys[0][1];
  const n = keys.length;
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (i < n - 2 && t > keys[i + 1][0]) i++;
  const [t1, p1] = keys[i];
  const [t2, p2] = keys[i + 1];
  const span = t2 - t1;
  if (span <= 1e-6) return p2;
  const u = (t - t1) / span;
  const a = flatten(p1);
  const b = flatten(p2);
  const prev = i > 0 ? keys[i - 1] : null;
  const next = i + 2 < n ? keys[i + 2] : null;
  const pa = prev ? flatten(prev[1]) : null;
  const nb = next ? flatten(next[1]) : null;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const out = a.map((av, k) => {
    const bv = b[k];
    // Same value at both keys: a hold, stay put.
    if (Math.abs(bv - av) < 1e-9) return av;
    // Tangents (per unit of this span); zero at the ends and where a key repeats (a hold).
    const m1 = pa && prev ? ((bv - pa[k]) / (t2 - prev[0])) * span : 0;
    const m2 = nb && next ? ((nb[k] - av) / (next[0] - t1)) * span : 0;
    const hold1 = pa !== null && Math.abs(pa[k] - av) < 1e-9;
    const hold2 = nb !== null && Math.abs(nb[k] - bv) < 1e-9;
    return h00 * av + h10 * (hold1 ? 0 : m1) + h01 * bv + h11 * (hold2 ? 0 : m2);
  });
  return unflatten(out, p1.bat ? p1 : p2);
}

/** Ease between two poses (for blending one animation into another). */
export function blendPose(a: Pose, b: Pose, t: number): Pose {
  return lerpPose(a, b, smooth(Math.max(0, Math.min(1, t))));
}

export function batDirection(bat: BatPose, out = new THREE.Vector3()): THREE.Vector3 {
  const y = THREE.MathUtils.degToRad(bat.yaw);
  const p = THREE.MathUtils.degToRad(bat.pitch);
  return out.set(Math.cos(p) * Math.cos(y), Math.sin(p), Math.cos(p) * Math.sin(y));
}

/** Two-bone IK. `outPerp` gets the bend direction (toward the pole, across the limb). */
function solveTwoBone(
  a: THREE.Vector3,
  target: THREE.Vector3,
  l1: number,
  l2: number,
  pole: THREE.Vector3,
  outMid: THREE.Vector3,
  outEnd: THREE.Vector3,
  outPerp: THREE.Vector3,
): void {
  const dir = new THREE.Vector3().subVectors(target, a);
  let d = dir.length();
  if (d < 1e-5) dir.set(0, -1, 0);
  dir.normalize();
  d = THREE.MathUtils.clamp(d, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.001);
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const perp = outPerp.subVectors(pole, a);
  perp.addScaledVector(dir, -perp.dot(dir));
  if (perp.lengthSq() < 1e-6) perp.set(0, 0, 1).addScaledVector(dir, -dir.z);
  perp.normalize();
  outMid.copy(a).addScaledVector(dir, l1 * cosA).addScaledVector(perp, l1 * sinA);
  outEnd.copy(a).addScaledVector(dir, d);
}

interface Limb {
  a: THREE.Vector3;
  mid: THREE.Vector3;
  end: THREE.Vector3;
  perp: THREE.Vector3;
}

interface Rig {
  pelvis: THREE.Matrix4;
  chest: THREE.Matrix4;
  arm: { R: Limb; L: Limb };
  leg: { R: Limb; L: Limb };
}

const limb = (): Limb => ({ a: new THREE.Vector3(), mid: new THREE.Vector3(), end: new THREE.Vector3(), perp: new THREE.Vector3() });
const ONE = new THREE.Vector3(1, 1, 1);

/** Solve the whole skeleton for a pose (root space). Shared by the bind pose and every frame. */
function solveRig(pose: Pose, handR: THREE.Vector3, handL: THREE.Vector3, out: Rig): Rig {
  const q = new THREE.Quaternion();
  out.pelvis.compose(new THREE.Vector3(...pose.pelvis), q.setFromEuler(new THREE.Euler(...pose.pelvisRot)), ONE);
  const chestLocal = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.25, 0), q.setFromEuler(new THREE.Euler(...pose.chestRot)), ONE);
  out.chest.multiplyMatrices(out.pelvis, chestLocal);
  for (const side of ['R', 'L'] as const) {
    const sign = side === 'R' ? -1 : 1;
    const arm = out.arm[side];
    arm.a.copy(side === 'R' ? SHOULDER_R : SHOULDER_L).applyMatrix4(out.chest);
    const pole = new THREE.Vector3(sign * 1.6, 0.4, -1.2).applyMatrix4(out.chest);
    solveTwoBone(arm.a, side === 'R' ? handR : handL, UPPER_ARM, FOREARM, pole, arm.mid, arm.end, arm.perp);
    const leg = out.leg[side];
    leg.a.copy(side === 'R' ? HIP_R : HIP_L).applyMatrix4(out.pelvis);
    const kneePole = new THREE.Vector3(sign * 0.2, -0.8, 2.5).applyMatrix4(out.pelvis);
    solveTwoBone(leg.a, new THREE.Vector3(...(side === 'R' ? pose.footR : pose.footL)), THIGH, SHIN, kneePole, leg.mid, leg.end, leg.perp);
  }
  return out;
}

const newRig = (): Rig => ({ pelvis: new THREE.Matrix4(), chest: new THREE.Matrix4(), arm: { R: limb(), L: limb() }, leg: { R: limb(), L: limb() } });

/**
 * A limb bone's transform: origin at `a`, +Y down the bone toward `b`, +Z the limb's
 * front (from the bend direction, so the twist stays stable as the joint bends).
 */
function limbFrame(out: THREE.Matrix4, a: THREE.Vector3, b: THREE.Vector3, perp: THREE.Vector3, flip: number): THREE.Matrix4 {
  const y = new THREE.Vector3().subVectors(b, a).normalize();
  const z = perp.clone().multiplyScalar(flip);
  z.addScaledVector(y, -z.dot(y));
  if (z.lengthSq() < 1e-6) z.set(0, 0, 1).addScaledVector(y, -y.z);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return out.makeBasis(x, y, z).setPosition(a);
}

/** Bones in BONE_NAMES order, from a solved rig. */
function boneMatrices(rig: Rig, out: THREE.Matrix4[]): void {
  out[0].copy(rig.pelvis);
  out[1].copy(rig.chest);
  limbFrame(out[2], rig.arm.R.a, rig.arm.R.mid, rig.arm.R.perp, -1);
  limbFrame(out[3], rig.arm.L.a, rig.arm.L.mid, rig.arm.L.perp, -1);
  limbFrame(out[4], rig.arm.R.mid, rig.arm.R.end, rig.arm.R.perp, -1);
  limbFrame(out[5], rig.arm.L.mid, rig.arm.L.end, rig.arm.L.perp, -1);
  limbFrame(out[6], rig.leg.R.a, rig.leg.R.mid, rig.leg.R.perp, 1);
  limbFrame(out[7], rig.leg.L.a, rig.leg.L.mid, rig.leg.L.perp, 1);
  limbFrame(out[8], rig.leg.R.mid, rig.leg.R.end, rig.leg.R.perp, 1);
  limbFrame(out[9], rig.leg.L.mid, rig.leg.L.end, rig.leg.L.perp, 1);
}

/** The rest pose the body mesh is built in: standing tall, arms hanging slightly out. */
const BIND = (() => {
  const pose: Pose = {
    pelvis: [0, 3.1, 0],
    pelvisRot: [0, 0, 0],
    chestRot: [0, 0, 0],
    handR: [0, 0, 0],
    handL: [0, 0, 0],
    footR: [-0.34, 0, 0],
    footL: [0.34, 0, 0],
  };
  const ang = THREE.MathUtils.degToRad(14);
  const reach = UPPER_ARM + FOREARM;
  const shR = SHOULDER_R.clone().add(new THREE.Vector3(0, 3.35, 0));
  const shL = SHOULDER_L.clone().add(new THREE.Vector3(0, 3.35, 0));
  const handR = shR.clone().add(new THREE.Vector3(-Math.sin(ang) * reach, -Math.cos(ang) * reach, 0));
  const handL = shL.clone().add(new THREE.Vector3(Math.sin(ang) * reach, -Math.cos(ang) * reach, 0));
  const rig = solveRig(pose, handR, handL, newRig());
  const mats = BONE_NAMES.map(() => new THREE.Matrix4());
  boneMatrices(rig, mats);
  const joints: BindJoints = {
    pelvis: new THREE.Vector3(0, 3.1, 0),
    chest: new THREE.Vector3(0, 3.35, 0),
    shoulder: { R: rig.arm.R.a.clone(), L: rig.arm.L.a.clone() },
    elbow: { R: rig.arm.R.mid.clone(), L: rig.arm.L.mid.clone() },
    wrist: { R: rig.arm.R.end.clone(), L: rig.arm.L.end.clone() },
    hip: { R: rig.leg.R.a.clone(), L: rig.leg.L.a.clone() },
    knee: { R: rig.leg.R.mid.clone(), L: rig.leg.L.mid.clone() },
    ankle: { R: rig.leg.R.end.clone(), L: rig.leg.L.end.clone() },
  };
  return { joints, inverses: mats.map((m) => m.clone().invert()) };
})();

/**
 * Primitive-built player. Limbs are solved with two-bone IK from hand/foot targets,
 * so animations are authored as target positions in root space.
 */
export class Humanoid {
  readonly root = new THREE.Group();
  readonly pelvis = new THREE.Group();
  readonly chest = new THREE.Group();
  /** Head, face, hair and cap/helmet: turns on the neck. */
  readonly head = new THREE.Group();
  private readonly blob: THREE.Mesh;
  readonly bat: THREE.Group | null;
  /** The skinned body and its bones (BONE_NAMES order), driven from the solved pose. */
  private readonly bones: THREE.Bone[];
  private readonly rig = newRig();
  private readonly boneMats = BONE_NAMES.map(() => new THREE.Matrix4());
  private readonly feet: { R: THREE.Group; L: THREE.Group };
  private readonly hands: { R: THREE.Group; L: THREE.Group };
  pose: Pose;
  private readonly gloveHand: 'L' | 'R' | null;

  /** Uniform size relative to a 6'1" player. */
  readonly scale: number;

  constructor(app: Appearance, opts: { bat?: boolean; mirrored?: boolean } = {}) {
    const build = app.build ?? 'athletic';
    this.gloveHand = app.gloveHand ?? null;
    const bw = build === 'slim' ? 0.9 : build === 'stocky' ? 1.15 : 1;
    const lw = build === 'slim' ? 0.9 : build === 'stocky' ? 1.12 : 1;
    const accent = app.undershirt ?? app.cap;
    const stripes = !!app.pinstripes;
    const cloth = (color: string, rough: number) =>
      new THREE.MeshPhysicalMaterial({ color, roughness: rough, sheen: 0.5, sheenRoughness: 0.75, sheenColor: new THREE.Color('#ffffff') });
    // Sleeves: the same cloth, striped around the sleeve itself.
    const jerseyPlain = cloth(app.jersey, 0.82);
    jerseyPlain.side = THREE.DoubleSide;
    clothShader(jerseyPlain, { stripes, stripeColor: accent, placket: false, local: true });
    const pants = cloth(app.pants, 0.88);
    clothShader(pants, { stripes, stripeColor: accent, placket: false });
    const skin = skinMaterial(app.skin);
    const skinDark = skinMaterial(shade(app.skin, 0.86));
    const cap = new THREE.MeshStandardMaterial({ map: capTexture(app.cap), roughness: 0.75 });
    const sleeve = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.8 });
    const shoe = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.5 });
    const glove = new THREE.MeshStandardMaterial({ color: app.gloveColor ?? '#7a4a21', roughness: 0.55 });
    const gloveDark = new THREE.MeshStandardMaterial({ color: shade(app.gloveColor ?? '#7a4a21', 0.72), roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.6 });
    const metal = new THREE.MeshStandardMaterial({ color: '#b9bcc2', roughness: 0.35, metalness: 0.8 });
    const hairMat = new THREE.MeshStandardMaterial({ color: app.hairColor ?? '#2a1b12', roughness: 0.9 });
    const sole = new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.8 });
    const lip = new THREE.MeshStandardMaterial({ color: shade(app.skin, 0.8), roughness: 0.5 });

    this.root.add(this.pelvis);
    this.pelvis.add(this.chest);
    this.scale = (app.heightIn ?? BASE_HEIGHT_IN) / BASE_HEIGHT_IN;
    this.root.scale.set(this.scale * (opts.mirrored ? -1 : 1), this.scale, this.scale);

    // Belt (the hips are part of the body mesh).
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.505, 0.505, 0.1, 28), dark);
    belt.scale.set(bw, 1, 0.64 * bw);
    belt.position.y = 0.3;
    this.pelvis.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, 0.04), metal);
    buckle.position.set(0, 0.3, 0.505 * 0.64 * bw + 0.01);
    this.pelvis.add(buckle);
    for (const a of [-0.8, 0.8, 2.3, -2.3]) {
      const loop = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.03), pants);
      loop.position.set(Math.sin(a) * 0.515 * bw, 0.3, Math.cos(a) * 0.515 * 0.64 * bw);
      loop.rotation.y = a;
      this.pelvis.add(loop);
    }

    // Collar in the team colour.
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.045, 10, 28), sleeve);
    collar.rotation.x = Math.PI / 2;
    collar.scale.set(bw, 0.75 * bw, 1);
    collar.position.y = 1.84;
    this.chest.add(collar);

    if (app.number !== undefined) {
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(0.95 * bw, 0.95),
        new THREE.MeshStandardMaterial({ map: backPlateTexture(app.backName, app.number, app.undershirt ?? app.cap), transparent: true, roughness: 0.8 }),
      );
      plate.position.set(0, 1.05, -0.64 * 0.62 * bw - 0.03);
      plate.rotation.y = Math.PI;
      // Keep the lettering readable on mirrored (left-handed) models.
      if (opts.mirrored) plate.scale.x = -1;
      this.chest.add(plate);
      // Small number on the front, over the heart (the model's left, +x).
      const front = new THREE.Mesh(
        new THREE.PlaneGeometry(0.3, 0.3),
        new THREE.MeshStandardMaterial({ map: frontNumberTexture(app.number, app.undershirt ?? app.cap), transparent: true, roughness: 0.8 }),
      );
      front.position.set(0.3 * bw, 1.3, 0.41 * bw + 0.02);
      front.rotation.y = 0.35;
      if (opts.mirrored) front.scale.x = -1;
      this.chest.add(front);
    }

    // Head: a cranium with a jaw blended in below it, so there's a chin and cheekbones
    // instead of a ball.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.37, 28, 20), skin);
    head.scale.set(0.95, 1.02, 1.05);
    head.position.set(0, 2.3, -0.02);
    head.castShadow = true;
    this.chest.add(head);
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.34, 22, 16), skin);
    jaw.scale.set(0.8, 0.62, 0.82);
    jaw.position.set(0, 2.02, 0.05);
    jaw.castShadow = true;
    this.chest.add(jaw);

    // Ears and nose.
    const earGeo = new THREE.SphereGeometry(0.085, 10, 8);
    for (const x of [-0.355, 0.355]) {
      const ear = new THREE.Mesh(earGeo, skin);
      ear.scale.set(0.5, 1, 0.8);
      ear.position.set(x, 2.26, -0.02);
      this.chest.add(ear);
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), skin);
    nose.scale.set(0.8, 1.15, 1);
    nose.position.set(0, 2.19, 0.4);
    this.chest.add(nose);

    // Face: eyes (whites, iris, pupil, upper lid), brows, lips, eye black, facial hair. The face points +z.
    const eyeGeo = new THREE.SphereGeometry(0.05, 14, 10);
    const lidGeo = new THREE.SphereGeometry(0.054, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const irisGeo = new THREE.CircleGeometry(0.03, 16);
    const pupilGeo = new THREE.CircleGeometry(0.014, 12);
    const white = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.3 });
    const iris = new THREE.MeshStandardMaterial({ color: irisColor(app.skin, (app.number ?? 0) + (app.hair?.length ?? 0)), roughness: 0.4 });
    const browGeo = new THREE.BoxGeometry(0.13, 0.03, 0.035);
    for (const x of [-0.13, 0.13]) {
      const eye = new THREE.Mesh(eyeGeo, white);
      eye.position.set(x, 2.31, 0.36);
      this.chest.add(eye);
      const ir = new THREE.Mesh(irisGeo, iris);
      ir.position.set(x, 2.31, 0.408);
      this.chest.add(ir);
      const pupil = new THREE.Mesh(pupilGeo, dark);
      pupil.position.set(x, 2.31, 0.41);
      this.chest.add(pupil);
      const lid = new THREE.Mesh(lidGeo, skinDark);
      lid.position.set(x, 2.312, 0.36);
      lid.rotation.x = -0.45;
      this.chest.add(lid);
      const brow = new THREE.Mesh(browGeo, hairMat);
      brow.position.set(x, 2.385, 0.385);
      brow.rotation.z = x < 0 ? -0.12 : 0.12;
      this.chest.add(brow);
      if (app.eyeBlack) {
        // A smear on the cheekbone, just under the eye.
        const eb = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.035, 0.015), dark);
        eb.position.set(x * 1.1, 2.235, 0.37);
        eb.rotation.z = x < 0 ? 0.15 : -0.15;
        this.chest.add(eb);
      }
    }
    // Lips: a thin upper lip, a fuller lower one, and the line between them.
    const upperLip = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.1, 4, 10), lip);
    upperLip.rotation.z = Math.PI / 2;
    upperLip.position.set(0, 2.1, 0.325);
    const lowerLip = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.085, 4, 10), lip);
    lowerLip.rotation.z = Math.PI / 2;
    lowerLip.position.set(0, 2.068, 0.322);
    const mouthLine = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.008, 0.01), dark);
    mouthLine.position.set(0, 2.085, 0.338);
    this.chest.add(upperLip, lowerLip, mouthLine);
    const fh = app.facialHair ?? 'none';
    if (fh === 'beard' || fh === 'stubble') {
      const beard = new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 16, 10, 0, Math.PI, Math.PI * 0.55, Math.PI * 0.4),
        fh === 'stubble' ? new THREE.MeshStandardMaterial({ color: app.hairColor ?? '#2a1b12', transparent: true, opacity: 0.35 }) : hairMat,
      );
      beard.scale.set(0.92, 1.0, 0.9);
      beard.position.set(0, 2.2, 0.02);
      this.chest.add(beard);
    }
    if (fh === 'goatee') {
      const g = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), hairMat);
      g.scale.set(1, 1.3, 0.6);
      g.position.set(0, 1.95, 0.29);
      this.chest.add(g);
    }
    if (fh === 'mustache' || fh === 'goatee' || fh === 'beard') {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.2, 4, 10), hairMat);
      m.rotation.z = Math.PI / 2;
      m.position.set(0, 2.135, 0.35);
      this.chest.add(m);
    }

    // Hair shows below the cap at the back and sides.
    const hair = app.hair ?? 'short';
    if (hair !== 'none') {
      const r = hair === 'buzz' ? 0.385 : hair === 'curly' ? 0.43 : 0.41;
      const band = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, Math.PI, Math.PI, Math.PI * 0.3, Math.PI * 0.35), hairMat);
      band.scale.set(0.97, 1.05, 1.02);
      band.position.set(0, 2.3, -0.02);
      this.chest.add(band);
      if (hair === 'long') {
        // Hair down the back of the neck, hugging the head.
        const tail = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 12, Math.PI * 0.6, Math.PI * 0.8, Math.PI * 0.35, Math.PI * 0.5), hairMat);
        tail.scale.set(1.15, 1.25, 1.05);
        tail.position.set(0, 2.1, -0.06);
        this.chest.add(tail);
      }
      if (hair === 'curly') {
        for (const [x, z] of [[-0.3, -0.2], [0.3, -0.2], [0, -0.38], [-0.18, -0.34], [0.18, -0.34]]) {
          const c = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), hairMat);
          c.position.set(x, 2.12, z);
          this.chest.add(c);
        }
      }
    }

    if (opts.bat) {
      // Batting helmet: glossy shell, short brim, ear flap on the side facing the pitcher.
      const shell = new THREE.MeshPhysicalMaterial({ color: app.cap, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12 });
      // Sits on top of the head, brow line clear, so the face shows under it.
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.44, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.52), shell);
      dome.scale.set(1, 0.92, 1.08);
      dome.position.set(0, 2.4, -0.02);
      this.chest.add(dome);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 24, 1, false, -Math.PI / 2, Math.PI), shell);
      brim.position.set(0, 2.44, 0.3);
      brim.scale.z = 0.8;
      brim.rotation.x = 0.1;
      this.chest.add(brim);
      const flap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI), shell);
      flap.rotation.y = Math.PI / 2;
      flap.scale.set(1, 1.05, 0.5);
      flap.position.set(0.38, 2.2, 0.0);
      this.chest.add(flap);
    } else {
      const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.41, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2), cap);
      capTop.scale.set(1, 0.9, 1.05);
      capTop.position.set(0, 2.4, -0.02);
      this.chest.add(capTop);
      const button = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshStandardMaterial({ color: app.cap, roughness: 0.7 }));
      button.position.set(0, 2.77, -0.02);
      this.chest.add(button);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.035, 28, 1, false, -Math.PI / 2, Math.PI), cap);
      brim.position.set(0, 2.42, 0.28);
      brim.scale.z = 1.25;
      brim.rotation.x = 0.1;
      this.chest.add(brim);
      if (app.logo) {
        const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshStandardMaterial({ map: logoTexture(app.logo, accent === app.cap ? '#ffffff' : accent), transparent: true, roughness: 0.7 }));
        logo.position.set(0, 2.54, 0.39);
        logo.rotation.x = -0.35;
        if (opts.mirrored) logo.scale.x = -1;
        this.chest.add(logo);
      }
    }

    // The body: one smooth skinned mesh (torso, hips, arms, legs, neck).
    const body = bodyFor(build, BIND.joints, bw, lw);
    this.bones = BONE_NAMES.map((name) => {
      const b = new THREE.Bone();
      b.name = name;
      b.matrixAutoUpdate = false;
      this.root.add(b);
      return b;
    });
    const mesh = new THREE.SkinnedMesh(body.geometry, bodyMaterial({ jersey: app.jersey, pants: app.pants, accent, skin: app.skin, stripes }, BIND.joints));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    mesh.bind(new THREE.Skeleton(this.bones, BIND.inverses.map((m) => m.clone())), new THREE.Matrix4());

    // Short, slightly flared jersey sleeves, riding on the upper arms.
    const sleevePts = [
      [0.25, -0.06],
      [0.245, 0.1],
      [0.225, 0.32],
      [0.215, 0.5],
    ].map(([r, y]) => new THREE.Vector2(r * lw, y));
    for (const b of [this.bones[2], this.bones[3]]) {
      const tube = new THREE.Mesh(new THREE.LatheGeometry(sleevePts, 24), jerseyPlain);
      tube.castShadow = true;
      b.add(tube);
    }
    if (opts.bat) {
      // Elbow guard on the lead arm (the left, in the model's own space), like the pros wear.
      const guardMat = new THREE.MeshPhysicalMaterial({ color: accent, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.3 });
      const guardPts = [
        [0.0, -0.17],
        [0.1, -0.15],
        [0.155, -0.05],
        [0.165, 0.1],
        [0.15, 0.3],
        [0.142, 0.36],
      ].map(([r, y]) => new THREE.Vector2(r * lw, y));
      const guard = new THREE.Mesh(new THREE.LatheGeometry(guardPts, 22), guardMat);
      guard.castShadow = true;
      this.bones[5].add(guard);
    }

    // Cleats: a rounded upper on a light sole.
    const makeShoe = () => {
      const shoeG = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.5, 6, 12), shoe);
      upper.rotation.x = Math.PI / 2;
      upper.scale.set(1.05, 1, 0.78);
      upper.position.set(0, 0.03, 0.22);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.78), sole);
      base.position.set(0, -0.09, 0.22);
      shoeG.add(upper, base);
      return shoeG;
    };
    this.feet = { R: makeShoe(), L: makeShoe() };
    this.root.add(this.feet.R, this.feet.L);

    // Hands: a palm with fingers and a thumb; the glove hand gets a fielder's glove with
    // finger stalls, a thumb and webbing. The hand group's +z is the body's forward.
    const makeHand = (side: 'R' | 'L'): THREE.Group => {
      const g = new THREE.Group();
      const inward = side === 'L' ? 1 : -1; // toward the body's centre, in the forearm's frame
      if (app.gloveHand === side) {
        const palm = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 14), glove);
        palm.scale.set(0.95, 1.1, 0.5);
        g.add(palm);
        const pocket = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), gloveDark);
        pocket.scale.set(1, 1.3, 0.3);
        pocket.position.set(inward * 0.02, 0.02, 0.14);
        g.add(pocket);
        for (let i = 0; i < 4; i++) {
          const stall = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.2, 6, 12), glove);
          const x = (i - 1.5) * 0.13;
          stall.position.set(x, 0.36, 0.0);
          stall.rotation.z = -x * 0.9;
          g.add(stall);
        }
        const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.2, 6, 12), glove);
        thumb.position.set(inward * 0.3, 0.1, 0.02);
        thumb.rotation.z = -inward * 1.0;
        g.add(thumb);
        const web = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.3, 0.035), gloveDark);
        web.position.set(inward * 0.22, 0.27, 0.0);
        web.rotation.z = -inward * 0.5;
        g.add(web);
      } else {
        const handMat = opts.bat ? new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6 }) : skin;
        const palm = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), handMat);
        palm.scale.set(0.5, 1, 0.85);
        g.add(palm);
        const fingers = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.14, 5, 10), handMat);
        fingers.scale.set(0.9, 1, 1.6);
        fingers.position.set(0, -0.17, 0.01);
        g.add(fingers);
        const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.1, 4, 8), handMat);
        thumb.position.set(0, -0.02, 0.12);
        thumb.rotation.x = Math.PI / 2;
        g.add(thumb);
      }
      return g;
    };
    this.hands = { R: makeHand('R'), L: makeHand('L') };
    this.root.add(this.hands.R, this.hands.L);

    if (opts.bat) {
      this.bat = new THREE.Group();
      const wood = new THREE.MeshStandardMaterial({ color: app.batColor ?? '#d8b27a', roughness: 0.45 });
      const pts = [
        new THREE.Vector2(0.07, 0),
        new THREE.Vector2(0.06, 0.05),
        new THREE.Vector2(0.045, 0.1),
        new THREE.Vector2(0.05, 1.2),
        new THREE.Vector2(0.1, 2.0),
        new THREE.Vector2(0.11, 2.75),
        new THREE.Vector2(0.09, 2.82),
        new THREE.Vector2(0, 2.83),
      ];
      const batMesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 16), wood);
      batMesh.castShadow = true;
      this.bat.add(batMesh);
      // Grip tape on the handle.
      const tape = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.052, 0.8, 12), new THREE.MeshStandardMaterial({ color: '#1c1c1c', roughness: 0.95 }));
      tape.position.y = 0.55;
      this.bat.add(tape);
      this.root.add(this.bat);
    } else {
      this.bat = null;
    }

    this.pose = {
      pelvis: [0, 3.1, 0],
      pelvisRot: [0, 0, 0],
      chestRot: [0, 0, 0],
      handR: [-0.9, 2.9, 0.2],
      handL: [0.9, 2.9, 0.2],
      footR: [-0.4, 0.2, 0],
      footL: [0.4, 0.2, 0],
    };
    // Everything above the neck turns together on a neck pivot.
    const NECK_Y = 1.9;
    this.head.position.set(0, NECK_Y, 0);
    for (const c of [...this.chest.children]) {
      if (c.position.y >= NECK_Y) {
        this.chest.remove(c);
        c.position.y -= NECK_Y;
        this.head.add(c);
      }
    }
    this.chest.add(this.head);

    // Only the big parts cast shadows; eyes, brows, buttons and the like aren't worth the cost.
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.computeBoundingSphere();
      m.castShadow = (m.geometry.boundingSphere?.radius ?? 1) > 0.12;
    });

    // Contact shadow: a soft dark patch on the ground under him, so he never looks like
    // he's floating (the sun's shadow doesn't reach every corner of the park).
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.55 }),
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.06;
    this.blob.renderOrder = 1;
    this.root.add(this.blob);
    this.apply(this.pose);
  }

  /** Root-space position of the right or left hand after the last apply(). */
  handPosition(side: 'R' | 'L', out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.hands[side].position);
  }

  apply(pose: Pose): void {
    this.pose = pose;
    this.pelvis.position.set(...pose.pelvis);
    this.pelvis.rotation.set(...pose.pelvisRot);
    this.chest.position.set(0, 0.25, 0);
    this.chest.rotation.set(...pose.chestRot);
    this.head.rotation.set(...(pose.headRot ?? ([0, 0, 0] as P3)));
    // Keep the contact shadow under the body, a little tighter when he's up in the air.
    if (this.blob) {
      this.blob.position.x = pose.pelvis[0];
      this.blob.position.z = pose.pelvis[2];
      const lift = Math.max(0, Math.min(pose.footL[1], pose.footR[1]) - 0.2);
      this.blob.scale.setScalar(Math.max(0.6, 1 - lift * 0.3));
    }
    this.pelvis.updateMatrix();
    this.chest.updateMatrix();

    let handR = new THREE.Vector3(...pose.handR);
    let handL = new THREE.Vector3(...pose.handL);
    if (pose.bat && this.bat) {
      const h = new THREE.Vector3(...pose.bat.h);
      const d = batDirection(pose.bat);
      this.bat.position.copy(h);
      this.bat.quaternion.setFromUnitVectors(UP, d);
      // Bottom hand (left for a righty) near the knob, top hand above it.
      handL = h.clone().addScaledVector(d, 0.12);
      handR = h.clone().addScaledVector(d, 0.36);
    }

    const rig = solveRig(pose, handR, handL, this.rig);
    boneMatrices(rig, this.boneMats);
    this.bones.forEach((b, i) => {
      b.matrix.copy(this.boneMats[i]);
      b.matrixWorldNeedsUpdate = true;
    });

    const flipZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
    for (const side of ['R', 'L'] as const) {
      // Hands follow the forearm: the glove's fingers continue it; a bare hand hangs off it.
      const fore = this.boneMats[side === 'R' ? 4 : 5];
      const hand = this.hands[side];
      hand.position.copy(rig.arm[side].end);
      hand.quaternion.setFromRotationMatrix(fore);
      if (this.gloveHand !== side) hand.quaternion.multiply(flipZ);

      const end = rig.leg[side].end;
      const f = this.feet[side];
      f.position.set(end.x, Math.max(0.12, end.y - 0.12), end.z);
      f.rotation.set(0, (side === 'R' ? pose.footYawR : pose.footYawL) ?? 0, 0);
    }
  }
}
