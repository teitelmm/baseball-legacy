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
  undershirt?: string;
  gloveHand?: 'L' | 'R' | null;
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

function segment(radiusTop: number, radiusBottom: number, mat: THREE.Material): THREE.Mesh {
  const g = new THREE.CylinderGeometry(radiusTop, radiusBottom, 1, 10);
  const m = new THREE.Mesh(g, mat);
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
  private readonly feet: { R: THREE.Mesh; L: THREE.Mesh };
  private readonly hands: { R: THREE.Mesh; L: THREE.Mesh };
  pose: Pose;

  constructor(app: Appearance, opts: { bat?: boolean; mirrored?: boolean } = {}) {
    const jersey = new THREE.MeshStandardMaterial({ color: app.jersey, roughness: 0.8 });
    const pants = new THREE.MeshStandardMaterial({ color: app.pants, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: app.skin, roughness: 0.7 });
    const cap = new THREE.MeshStandardMaterial({ color: app.cap, roughness: 0.6 });
    const sleeve = new THREE.MeshStandardMaterial({ color: app.undershirt ?? app.cap, roughness: 0.8 });
    const shoe = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.5 });
    const glove = new THREE.MeshStandardMaterial({ color: '#7a4a21', roughness: 0.6 });

    this.root.add(this.pelvis);
    this.pelvis.add(this.chest);
    if (opts.mirrored) this.root.scale.x = -1;

    const hips = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.62), pants);
    hips.position.y = 0.05;
    hips.castShadow = true;
    this.pelvis.add(hips);

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.52, 1.55, 14), jersey);
    torso.scale.z = 0.62;
    torso.position.y = 0.95;
    torso.castShadow = true;
    this.chest.add(torso);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.3, 8), skin);
    neck.position.y = 1.85;
    this.chest.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 12), skin);
    head.scale.set(0.95, 1.1, 1);
    head.position.y = 2.25;
    head.castShadow = true;
    this.chest.add(head);

    const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), cap);
    capTop.position.y = 2.33;
    this.chest.add(capTop);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 16, 1, false, -Math.PI / 2, Math.PI), cap);
    brim.position.set(0, 2.36, 0.28);
    brim.scale.z = 1.2;
    this.chest.add(brim);

    this.limbs.thighR = segment(0.27, 0.2, pants);
    this.limbs.shinR = segment(0.2, 0.15, pants);
    this.limbs.thighL = segment(0.27, 0.2, pants);
    this.limbs.shinL = segment(0.2, 0.15, pants);
    this.limbs.upperR = segment(0.17, 0.14, sleeve);
    this.limbs.foreR = segment(0.13, 0.11, skin);
    this.limbs.upperL = segment(0.17, 0.14, sleeve);
    this.limbs.foreL = segment(0.13, 0.11, skin);
    for (const m of Object.values(this.limbs)) this.root.add(m);

    for (const name of ['kneeR', 'kneeL', 'elbowR', 'elbowL']) {
      const isKnee = name.startsWith('knee');
      const j = new THREE.Mesh(new THREE.SphereGeometry(isKnee ? 0.2 : 0.14, 10, 8), isKnee ? pants : sleeve);
      this.joints[name] = j;
      this.root.add(j);
    }

    const footGeo = new THREE.BoxGeometry(0.34, 0.24, 0.9);
    footGeo.translate(0, 0, 0.22);
    this.feet = { R: new THREE.Mesh(footGeo, shoe), L: new THREE.Mesh(footGeo, shoe) };
    this.root.add(this.feet.R, this.feet.L);

    const handGeo = new THREE.SphereGeometry(0.15, 10, 8);
    const gloveGeo = new THREE.SphereGeometry(0.3, 12, 10);
    gloveGeo.scale(1, 1.15, 0.55);
    this.hands = {
      R: new THREE.Mesh(app.gloveHand === 'R' ? gloveGeo : handGeo, app.gloveHand === 'R' ? glove : skin),
      L: new THREE.Mesh(app.gloveHand === 'L' ? gloveGeo : handGeo, app.gloveHand === 'L' ? glove : skin),
    };
    this.root.add(this.hands.R, this.hands.L);

    if (opts.bat) {
      this.bat = new THREE.Group();
      const wood = new THREE.MeshStandardMaterial({ color: '#d8b27a', roughness: 0.45 });
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
      placeSegment(this.limbs[`fore${side}`], mid, end);
      this.joints[`elbow${side}`].position.copy(mid);
      this.hands[side].position.copy(end);
      this.hands[side].quaternion.copy(this.pelvis.quaternion).multiply(this.chest.quaternion);

      const hip = toRoot(side === 'R' ? HIP_R : HIP_L, false);
      const foot = new THREE.Vector3(...(side === 'R' ? pose.footR : pose.footL));
      const kneePole = toRoot(new THREE.Vector3(sign * 0.2, -0.8, 2.5), false);
      solveTwoBone(hip, foot, THIGH, SHIN, kneePole, mid, end);
      placeSegment(this.limbs[`thigh${side}`], hip, mid);
      placeSegment(this.limbs[`shin${side}`], mid, end);
      this.joints[`knee${side}`].position.copy(mid);
      const f = this.feet[side];
      f.position.set(end.x, Math.max(0.12, end.y - 0.12), end.z);
      f.rotation.set(0, (side === 'R' ? pose.footYawR : pose.footYawL) ?? 0, 0);
    }
  }
}
