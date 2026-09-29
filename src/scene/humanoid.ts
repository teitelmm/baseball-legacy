import * as THREE from 'three';

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
  return p;
}

/** Sample keyframes at time t with smoothstep easing between keys. */
export function samplePose(keys: Keyframes, t: number): Pose {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, p0] = keys[i];
    const [t1, p1] = keys[i + 1];
    if (t <= t1) return lerpPose(p0, p1, smooth((t - t0) / (t1 - t0)));
  }
  return keys[keys.length - 1][1];
}

export function batDirection(bat: BatPose, out = new THREE.Vector3()): THREE.Vector3 {
  const y = THREE.MathUtils.degToRad(bat.yaw);
  const p = THREE.MathUtils.degToRad(bat.pitch);
  return out.set(Math.cos(p) * Math.cos(y), Math.sin(p), Math.cos(p) * Math.sin(y));
}

function solveTwoBone(
  a: THREE.Vector3,
  target: THREE.Vector3,
  l1: number,
  l2: number,
  pole: THREE.Vector3,
  outMid: THREE.Vector3,
  outEnd: THREE.Vector3,
): void {
  const dir = new THREE.Vector3().subVectors(target, a);
  let d = dir.length();
  if (d < 1e-5) dir.set(0, -1, 0);
  dir.normalize();
  d = THREE.MathUtils.clamp(d, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.001);
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const perp = new THREE.Vector3().subVectors(pole, a);
  perp.addScaledVector(dir, -perp.dot(dir));
  if (perp.lengthSq() < 1e-6) perp.set(0, 0, 1).addScaledVector(dir, -dir.z);
  perp.normalize();
  outMid.copy(a).addScaledVector(dir, l1 * cosA).addScaledVector(perp, l1 * sinA);
  outEnd.copy(a).addScaledVector(dir, d);
}

/**
 * A limb segment one unit long (stretched to fit between two joints). It tapers from
 * `rProx` at the near joint to `rDist` at the far one, with a muscle bulge (thigh,
 * calf, biceps, forearm) at `bulgeAt` of the way down.
 */
function segment(rProx: number, rDist: number, mat: THREE.Material, bulge = 1, bulgeAt = 0.3): THREE.Mesh {
  const pts: THREE.Vector2[] = [];
  for (const f of [0, 0.12, 0.25, 0.4, 0.55, 0.7, 0.85, 1]) {
    const base = rProx + (rDist - rProx) * f;
    const k = 1 + (bulge - 1) * Math.exp(-(((f - bulgeAt) / 0.22) ** 2));
    pts.push(new THREE.Vector2(base * k, f - 0.5));
  }
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 14), mat);
  m.castShadow = true;
  return m;
}

function placeSegment(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
  const d = new THREE.Vector3().subVectors(to, from);
  const len = d.length();
  mesh.position.copy(from).addScaledVector(d, 0.5);
  if (len > 1e-5) mesh.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
  mesh.scale.set(1, Math.max(len, 1e-3), 1);
}

/**
 * Primitive-built player. Limbs are solved with two-bone IK from hand/foot targets,
 * so animations are authored as target positions in root space.
 */
export class Humanoid {
  readonly root = new THREE.Group();
  readonly pelvis = new THREE.Group();
  readonly chest = new THREE.Group();
  readonly bat: THREE.Group | null;
  private readonly limbs: Record<string, THREE.Mesh> = {};
  private readonly joints: Record<string, THREE.Mesh> = {};
  private readonly feet: { R: THREE.Group; L: THREE.Group };
  private readonly hands: { R: THREE.Mesh; L: THREE.Mesh };
  pose: Pose;

  /** Uniform size relative to a 6'1" player. */
  readonly scale: number;

  constructor(app: Appearance, opts: { bat?: boolean; mirrored?: boolean } = {}) {
    const build = app.build ?? 'athletic';
    const bw = build === 'slim' ? 0.9 : build === 'stocky' ? 1.15 : 1;
    const lw = build === 'slim' ? 0.9 : build === 'stocky' ? 1.12 : 1;
    const jersey = new THREE.MeshStandardMaterial({ color: app.jersey, roughness: 0.8 });
    const pants = new THREE.MeshStandardMaterial({ color: app.pants, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: app.skin, roughness: 0.7 });
    const cap = new THREE.MeshStandardMaterial({ color: app.cap, roughness: 0.6 });
    const sleeve = new THREE.MeshStandardMaterial({ color: app.undershirt ?? app.cap, roughness: 0.8 });
    const shoe = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.5 });
    const glove = new THREE.MeshStandardMaterial({ color: app.gloveColor ?? '#7a4a21', roughness: 0.6 });
    const socks = new THREE.MeshStandardMaterial({ color: app.undershirt ?? app.cap, roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.6 });
    const hairMat = new THREE.MeshStandardMaterial({ color: app.hairColor ?? '#2a1b12', roughness: 0.9 });
    const sole = new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.8 });

    this.root.add(this.pelvis);
    this.pelvis.add(this.chest);
    this.scale = (app.heightIn ?? BASE_HEIGHT_IN) / BASE_HEIGHT_IN;
    this.root.scale.set(this.scale * (opts.mirrored ? -1 : 1), this.scale, this.scale);

    // Rounded hips and a belt.
    const hips = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 12), pants);
    hips.scale.set(0.98 * bw, 0.56, 0.6 * bw);
    hips.position.y = 0.14;
    hips.castShadow = true;
    this.pelvis.add(hips);
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.505, 0.505, 0.1, 20), dark);
    belt.scale.set(bw, 1, 0.64 * bw);
    belt.position.y = 0.3;
    this.pelvis.add(belt);

    // Athletic torso: narrow waist, broad chest, rounded shoulders (a lathe, flattened front to back).
    const profile = [
      [0.5, 0.15],
      [0.53, 0.4],
      [0.6, 0.8],
      [0.7, 1.2],
      [0.74, 1.45],
      [0.72, 1.62],
      [0.6, 1.76],
      [0.36, 1.86],
      [0.0, 1.9],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const torso = new THREE.Mesh(new THREE.LatheGeometry(profile, 24), jersey);
    torso.scale.set(bw, 1, 0.62 * bw);
    torso.castShadow = true;
    this.chest.add(torso);

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

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.3, 8), skin);
    neck.position.y = 1.85;
    this.chest.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 12), skin);
    head.scale.set(0.95, 1.1, 1);
    head.position.y = 2.25;
    head.castShadow = true;
    this.chest.add(head);

    // Ears and nose.
    const earGeo = new THREE.SphereGeometry(0.085, 10, 8);
    for (const x of [-0.36, 0.36]) {
      const ear = new THREE.Mesh(earGeo, skin);
      ear.scale.set(0.5, 1, 0.8);
      ear.position.set(x, 2.24, 0.0);
      this.chest.add(ear);
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), skin);
    nose.scale.set(0.8, 1.1, 1);
    nose.position.set(0, 2.19, 0.38);
    this.chest.add(nose);

    // Face: eyes (whites and pupils), brows, mouth, eye black, facial hair. The face points +z.
    const eyeGeo = new THREE.SphereGeometry(0.05, 12, 8);
    const pupilGeo = new THREE.SphereGeometry(0.026, 8, 6);
    const white = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.35 });
    const browGeo = new THREE.BoxGeometry(0.13, 0.03, 0.035);
    for (const x of [-0.13, 0.13]) {
      const eye = new THREE.Mesh(eyeGeo, white);
      eye.position.set(x, 2.31, 0.325);
      this.chest.add(eye);
      const pupil = new THREE.Mesh(pupilGeo, dark);
      pupil.position.set(x, 2.31, 0.37);
      this.chest.add(pupil);
      const brow = new THREE.Mesh(browGeo, hairMat);
      brow.position.set(x, 2.385, 0.35);
      brow.rotation.z = x < 0 ? -0.12 : 0.12;
      this.chest.add(brow);
      if (app.eyeBlack) {
        const eb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.02), dark);
        eb.position.set(x, 2.22, 0.36);
        this.chest.add(eb);
      }
    }
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.022, 0.03), new THREE.MeshStandardMaterial({ color: '#7a3b33', roughness: 0.6 }));
    mouth.position.set(0, 2.08, 0.345);
    this.chest.add(mouth);
    const fh = app.facialHair ?? 'none';
    if (fh === 'beard' || fh === 'stubble') {
      const beard = new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 16, 10, 0, Math.PI, Math.PI * 0.55, Math.PI * 0.4),
        fh === 'stubble' ? new THREE.MeshStandardMaterial({ color: app.hairColor ?? '#2a1b12', transparent: true, opacity: 0.35 }) : hairMat,
      );
      beard.scale.set(0.97, 1.12, 1.02);
      beard.position.y = 2.25;
      this.chest.add(beard);
    }
    if (fh === 'goatee') {
      const g = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), hairMat);
      g.scale.set(1, 1.3, 0.6);
      g.position.set(0, 1.95, 0.3);
      this.chest.add(g);
    }
    if (fh === 'mustache' || fh === 'goatee' || fh === 'beard') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.05), hairMat);
      m.position.set(0, 2.12, 0.37);
      this.chest.add(m);
    }

    // Hair shows below the cap at the back and sides.
    const hair = app.hair ?? 'short';
    if (hair !== 'none') {
      const r = hair === 'buzz' ? 0.39 : hair === 'curly' ? 0.44 : 0.415;
      const band = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 10, Math.PI, Math.PI, Math.PI * 0.3, Math.PI * 0.35), hairMat);
      band.scale.set(0.97, 1.1, 1.02);
      band.position.y = 2.25;
      this.chest.add(band);
      if (hair === 'long') {
        const tail = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.62, 0.12), hairMat);
        tail.position.set(0, 1.92, -0.3);
        this.chest.add(tail);
      }
      if (hair === 'curly') {
        for (const [x, z] of [[-0.3, -0.18], [0.3, -0.18], [0, -0.36], [-0.18, -0.32], [0.18, -0.32]]) {
          const c = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), hairMat);
          c.position.set(x, 2.08, z);
          this.chest.add(c);
        }
      }
    }

    if (opts.bat) {
      // Batting helmet: glossy shell, short brim, ear flap on the side facing the pitcher.
      const shell = new THREE.MeshPhysicalMaterial({ color: app.cap, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12 });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.58), shell);
      dome.scale.set(1, 0.95, 1.08);
      dome.position.y = 2.24;
      this.chest.add(dome);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 20, 1, false, -Math.PI / 2, Math.PI), shell);
      brim.position.set(0, 2.33, 0.3);
      brim.scale.z = 0.8;
      brim.rotation.x = 0.12;
      this.chest.add(brim);
      const flap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI), shell);
      flap.rotation.y = Math.PI / 2;
      flap.scale.set(1, 1.05, 0.5);
      flap.position.set(0.38, 2.12, 0.02);
      this.chest.add(flap);
    } else {
      const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.41, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), cap);
      capTop.scale.set(1, 0.9, 1.05);
      capTop.position.y = 2.32;
      this.chest.add(capTop);
      const button = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), cap);
      button.position.y = 2.69;
      this.chest.add(button);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 20, 1, false, -Math.PI / 2, Math.PI), cap);
      brim.position.set(0, 2.34, 0.3);
      brim.scale.z = 1.25;
      brim.rotation.x = 0.1;
      this.chest.add(brim);
    }

    // Tapered, muscled limbs: quads, calves, biceps and forearms.
    this.limbs.thighR = segment(0.27 * lw, 0.19 * lw, pants, 1.1, 0.3);
    this.limbs.shinR = segment(0.19 * lw, 0.13 * lw, socks, 1.16, 0.28);
    this.limbs.thighL = segment(0.27 * lw, 0.19 * lw, pants, 1.1, 0.3);
    this.limbs.shinL = segment(0.19 * lw, 0.13 * lw, socks, 1.16, 0.28);
    this.limbs.upperR = segment(0.17 * lw, 0.13 * lw, sleeve, 1.1, 0.45);
    this.limbs.foreR = segment(0.135 * lw, 0.095 * lw, skin, 1.1, 0.2);
    this.limbs.upperL = segment(0.17 * lw, 0.13 * lw, sleeve, 1.1, 0.45);
    this.limbs.foreL = segment(0.135 * lw, 0.095 * lw, skin, 1.1, 0.2);
    // Short jersey sleeves over the undershirt.
    this.limbs.sleeveR = segment(0.21 * lw, 0.19 * lw, jersey);
    this.limbs.sleeveL = segment(0.21 * lw, 0.19 * lw, jersey);
    for (const m of Object.values(this.limbs)) this.root.add(m);

    // Ball joints round off the ends of the limb segments.
    const jointSpec: Array<[string, number, THREE.Material]> = [
      ['kneeR', 0.2 * lw, pants],
      ['kneeL', 0.2 * lw, pants],
      ['elbowR', 0.14 * lw, sleeve],
      ['elbowL', 0.14 * lw, sleeve],
      ['shoulderR', 0.21 * lw, jersey],
      ['shoulderL', 0.21 * lw, jersey],
      ['hipR', 0.27 * lw, pants],
      ['hipL', 0.27 * lw, pants],
      ['ankleR', 0.15 * lw, socks],
      ['ankleL', 0.15 * lw, socks],
    ];
    for (const [name, r, mat] of jointSpec) {
      const j = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
      this.joints[name] = j;
      this.root.add(j);
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

    const handGeo = new THREE.SphereGeometry(0.15, 12, 10);
    handGeo.scale(0.8, 1.1, 0.65);
    const gloveGeo = new THREE.SphereGeometry(0.3, 12, 10);
    gloveGeo.scale(1, 1.15, 0.55);
    this.hands = {
      R: new THREE.Mesh(app.gloveHand === 'R' ? gloveGeo : handGeo, app.gloveHand === 'R' ? glove : skin),
      L: new THREE.Mesh(app.gloveHand === 'L' ? gloveGeo : handGeo, app.gloveHand === 'L' ? glove : skin),
    };
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
      const batMesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 12), wood);
      batMesh.castShadow = true;
      this.bat.add(batMesh);
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
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
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
    this.pelvis.updateMatrix();
    this.chest.updateMatrix();

    const toRoot = (local: THREE.Vector3, viaChest: boolean) => {
      const v = local.clone();
      if (viaChest) v.applyMatrix4(this.chest.matrix);
      return v.applyMatrix4(this.pelvis.matrix);
    };

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

    const mid = new THREE.Vector3();
    const end = new THREE.Vector3();
    for (const side of ['R', 'L'] as const) {
      const sign = side === 'R' ? -1 : 1;
      const shoulder = toRoot(side === 'R' ? SHOULDER_R : SHOULDER_L, true);
      const target = side === 'R' ? handR : handL;
      const pole = toRoot(new THREE.Vector3(sign * 1.6, 0.4, -1.2), true);
      solveTwoBone(shoulder, target, UPPER_ARM, FOREARM, pole, mid, end);
      placeSegment(this.limbs[`upper${side}`], shoulder, mid);
      placeSegment(this.limbs[`sleeve${side}`], shoulder, shoulder.clone().lerp(mid, 0.45));
      placeSegment(this.limbs[`fore${side}`], mid, end);
      this.joints[`shoulder${side}`].position.copy(shoulder);
      this.joints[`elbow${side}`].position.copy(mid);
      this.hands[side].position.copy(end);
      this.hands[side].quaternion.copy(this.pelvis.quaternion).multiply(this.chest.quaternion);

      const hip = toRoot(side === 'R' ? HIP_R : HIP_L, false);
      const foot = new THREE.Vector3(...(side === 'R' ? pose.footR : pose.footL));
      const kneePole = toRoot(new THREE.Vector3(sign * 0.2, -0.8, 2.5), false);
      solveTwoBone(hip, foot, THIGH, SHIN, kneePole, mid, end);
      placeSegment(this.limbs[`thigh${side}`], hip, mid);
      placeSegment(this.limbs[`shin${side}`], mid, end);
      this.joints[`hip${side}`].position.copy(hip);
      this.joints[`knee${side}`].position.copy(mid);
      this.joints[`ankle${side}`].position.copy(end);
      const f = this.feet[side];
      f.position.set(end.x, Math.max(0.12, end.y - 0.12), end.z);
      f.rotation.set(0, (side === 'R' ? pose.footYawR : pose.footYawL) ?? 0, 0);
    }
  }
}
