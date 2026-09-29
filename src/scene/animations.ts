import { SWING_TIME_MS } from '../core/constants';
import { lerpPose, type Keyframes, type Pose } from './humanoid';

// All poses are in the model's root space: it faces +z and its right side is -x.
// Batter: the plate is +z, the pitcher +x (mirrored for lefties).
// Pitcher: the plate is +z. Catcher / fielders: home plate is +z.

/**
 * Turn the head so the eyes point `yaw` radians from the model's forward (+z), whatever
 * the hips and shoulders are doing; `nod` tips the head down. The neck only turns so far.
 */
export function eyesOn(p: Pose, yaw: number, nod = 0.08): Pose {
  const turn = Math.max(-1.65, Math.min(1.65, yaw - p.pelvisRot[1] - p.chestRot[1]));
  return { ...p, headRot: [nod - p.chestRot[0] * 0.5, turn, 0] };
}

/** Where the batter looks: at the pitcher (+x), a bit toward the plate. */
const BATTER_EYES = 1.4;

const BASE_STANCE: Pose = {
  pelvis: [0, 2.95, 0],
  pelvisRot: [0, -0.15, 0],
  chestRot: [0.12, -0.25, 0],
  handR: [0, 0, 0],
  handL: [0, 0, 0],
  footR: [-1.35, 0.2, 0],
  footL: [1.3, 0.2, 0.1],
  footYawR: 0.2,
  footYawL: -0.2,
  bat: { h: [-0.35, 4.3, 0.6], yaw: 200, pitch: 58 },
};

export const BATTER_STANCE: Pose = eyesOn(BASE_STANCE, BATTER_EYES);

export const BATTER_LOAD: Pose = eyesOn(
  {
    ...BASE_STANCE,
    pelvis: [-0.25, 2.9, 0],
    pelvisRot: [0, -0.3, 0],
    chestRot: [0.12, -0.4, 0],
    footL: [1.15, 0.45, 0.1],
    bat: { h: [-0.75, 4.4, 0.45], yaw: 205, pitch: 50 },
  },
  BATTER_EYES,
);

/** Before the pitch: a little rhythm, the bat waggling over the shoulder. */
export function batterWaggle(t: number): Pose {
  const w = Math.sin(t * 2.2);
  const b = BATTER_STANCE.bat!;
  return {
    ...BATTER_STANCE,
    pelvis: [BATTER_STANCE.pelvis[0] - 0.04 * Math.sin(t * 1.1), BATTER_STANCE.pelvis[1], 0],
    bat: { h: [b.h[0], b.h[1] + 0.05 * w, b.h[2]], yaw: b.yaw + 6 * w, pitch: b.pitch + 5 * Math.sin(t * 2.2 + 0.8) },
  };
}

/** Seconds from the start of the swing until the barrel reaches the ball. */
export const SWING_CONTACT_T = SWING_TIME_MS / 1000;
export const SWING_DURATION = SWING_CONTACT_T + 0.6;
const BAT_SWEET_SPOT = 2.2;

/**
 * Swing keyframes (seconds from swing start). contactZ/contactY is where the barrel's
 * sweet spot should be at contact, in the batter's root space.
 */
export function batterSwingKeys(contactZ: number, contactY: number): Keyframes {
  const handleY = 3.55 + 0.45 * (contactY - 2.5);
  const sinP = Math.max(-0.95, Math.min(0.6, (contactY - handleY) / BAT_SWEET_SPOT));
  const pitch = (Math.asin(sinP) * 180) / Math.PI;
  const yaw = 78;
  const reach = BAT_SWEET_SPOT * Math.cos((pitch * Math.PI) / 180) * Math.sin((yaw * Math.PI) / 180);
  const handleZ = Math.max(0.3, Math.min(1.7, contactZ - reach));

  const stride: Pose = {
    ...BATTER_LOAD,
    pelvis: [0, 2.8, 0.05],
    pelvisRot: [0, 0.2, 0],
    chestRot: [0.15, -0.15, 0],
    footL: [1.65, 0.2, 0.15],
    bat: { h: [-0.6, 4.0, 0.7], yaw: 192, pitch: 28 },
  };
  const launch: Pose = {
    ...stride,
    pelvisRot: [0, 0.75, 0],
    chestRot: [0.2, 0.25, 0],
    bat: { h: [-0.15, (handleY + 4.0) / 2, (handleZ + 0.7) / 2], yaw: 150, pitch: pitch * 0.4 },
  };
  const contact: Pose = {
    ...stride,
    pelvis: [0.05, 2.78, 0.05],
    pelvisRot: [0, 1.0, 0],
    chestRot: [0.15 + Math.max(0, 2.5 - contactY) * 0.18, 0.55, 0],
    footYawR: 0.9,
    bat: { h: [0.3, handleY, handleZ], yaw, pitch },
  };
  const extend: Pose = {
    ...contact,
    pelvisRot: [0, 1.3, 0],
    chestRot: [0.1, 1.0, 0],
    footR: [-1.25, 0.35, 0],
    bat: { h: [0.95, handleY + 0.4, handleZ - 0.3], yaw: -10, pitch: 5 },
  };
  const finish: Pose = {
    ...extend,
    pelvisRot: [0, 1.4, 0],
    chestRot: [0.0, 1.35, 0],
    footR: [-1.1, 0.45, 0.05],
    bat: { h: [0.65, 4.6, 0.25], yaw: -150, pitch: 38 },
  };
  const c = SWING_CONTACT_T;
  // Eyes stay on the ball: on the pitcher through the stride, then down on the contact
  // point, holding there after contact before the head comes around with the finish.
  const contactYaw = Math.atan2(1.0, Math.max(0.5, contactZ)) + 0.35;
  return [
    [0, BATTER_LOAD],
    [c * 0.4, eyesOn(stride, BATTER_EYES)],
    [c * 0.73, eyesOn(launch, (BATTER_EYES + contactYaw) / 2, 0.2)],
    [c, eyesOn(contact, contactYaw, 0.35)],
    [c + 0.07, eyesOn(extend, contactYaw, 0.35)],
    [c + 0.25, { ...finish, headRot: [0.15, 0.1, 0] }],
    [SWING_DURATION, { ...finish, headRot: [0.1, 0.05, 0] }],
  ];
}

/** Load keyframes played during the pitcher's windup (time 0..1 of windup). */
export function batterLoadKeys(): Keyframes {
  return [
    [0, BATTER_STANCE],
    [0.55, BATTER_STANCE],
    [0.85, BATTER_LOAD],
    [1, BATTER_LOAD],
  ];
}

// ---------------------------------------------------------------------------
// Pitcher

export const WINDUP_DURATION = 1.3; // seconds until release
export const PITCH_ANIM_DURATION = 2.1;

const PITCHER_SET: Pose = {
  pelvis: [0, 3.05, 0],
  pelvisRot: [0, 0, 0],
  chestRot: [0.05, 0, 0],
  handR: [-0.12, 4.15, 0.6],
  handL: [0.12, 4.15, 0.65],
  footR: [-0.45, 0.2, 0.05],
  footL: [0.5, 0.2, -0.35],
};

export function pitcherKeys(): Keyframes {
  const pivot: Pose = {
    ...PITCHER_SET,
    pelvisRot: [0, -1.25, 0],
    chestRot: [0.05, -0.2, 0],
    handR: [0.3, 4.3, 0.2],
    handL: [0.35, 4.3, 0.4],
    footR: [-0.35, 0.2, 0.25],
    footYawR: -1.4,
    footL: [0.6, 0.35, -0.2],
  };
  const lift: Pose = {
    ...pivot,
    pelvis: [-0.05, 3.15, -0.05],
    footL: [0.25, 2.3, 0.45],
    handR: [0.35, 4.4, 0.3],
    handL: [0.4, 4.4, 0.5],
  };
  const stride: Pose = {
    ...lift,
    pelvis: [-0.15, 2.85, 1.3],
    pelvisRot: [0, -1.1, 0],
    chestRot: [0.0, -0.3, 0],
    footL: [0.35, 0.7, 3.0],
    handR: [-1.3, 3.9, -1.0],
    handL: [0.7, 4.3, 2.0],
  };
  const plant: Pose = {
    ...stride,
    pelvis: [-0.25, 2.5, 2.9],
    pelvisRot: [0, -0.55, 0],
    chestRot: [0.1, -0.2, 0.1],
    footL: [0.35, -0.2, 5.1],
    footYawL: 0,
    footR: [-0.35, 0.2, 0.45],
    handR: [-1.7, 5.4, 1.4],
    handL: [0.8, 3.9, 3.8],
  };
  const release: Pose = {
    ...plant,
    pelvis: [-0.3, 2.4, 3.8],
    pelvisRot: [0.15, 0.2, 0],
    chestRot: [0.55, 0.35, 0.05],
    footR: [-0.3, 0.45, 1.6],
    handR: [-1.9, 5.07, 6.2],
    handL: [0.9, 3.4, 4.0],
  };
  const follow: Pose = {
    ...release,
    pelvis: [-0.1, 2.35, 4.3],
    pelvisRot: [0.25, 0.6, 0],
    chestRot: [0.8, 0.6, 0.05],
    footR: [-0.4, 1.3, 2.8],
    handR: [0.9, 2.4, 5.4],
    handL: [0.9, 3.4, 3.9],
  };
  const ready: Pose = {
    pelvis: [0, 2.8, 4.4],
    pelvisRot: [0, 0, 0],
    chestRot: [0.3, 0, 0],
    footL: [0.75, -0.25, 5.0],
    footR: [-0.85, -0.2, 4.6],
    handR: [-0.55, 3.2, 5.3],
    handL: [0.55, 3.4, 5.4],
  };
  // Eyes on the catcher's mitt the whole way through the delivery.
  const set = eyesOn(PITCHER_SET, 0, 0.05);
  return [
    [0, set],
    [0.3, set],
    [0.55, eyesOn(pivot, 0, 0.05)],
    [0.8, eyesOn(lift, 0, 0.05)],
    [1.0, eyesOn(stride, 0, 0.05)],
    [1.18, eyesOn(plant, 0, 0.1)],
    [WINDUP_DURATION, eyesOn(release, 0, 0.15)],
    [1.55, eyesOn(follow, 0.1, 0.2)],
    [PITCH_ANIM_DURATION, eyesOn(ready, 0, 0.1)],
  ];
}

export function pitcherSetPose(): Pose {
  return eyesOn(PITCHER_SET, 0, 0.05);
}

// ---------------------------------------------------------------------------
// Catcher, umpire, fielders

export function catcherPose(mitt: [number, number, number]): Pose {
  return {
    pelvis: [0, 1.4, 0],
    pelvisRot: [0.35, 0, 0],
    chestRot: [0.25, 0, 0],
    handR: [-0.7, 1.6, 0.4],
    handL: mitt,
    footR: [-0.95, 0.2, 0.25],
    footL: [0.95, 0.2, 0.25],
    footYawR: 0.4,
    footYawL: -0.4,
  };
}

export const UMPIRE_POSE: Pose = {
  pelvis: [0, 2.7, 0],
  pelvisRot: [0.2, 0, 0],
  chestRot: [0.55, 0, 0],
  handR: [-0.7, 2.6, 0.9],
  handL: [0.7, 2.6, 0.9],
  footR: [-1.0, 0.2, 0],
  footL: [1.0, 0.2, 0.1],
};

/**
 * Fielder between pitches (`ready` 0) and in the athletic crouch as the pitch is
 * delivered (`ready` 1): feet wide, knees bent, glove out front.
 */
export function fielderReadyPose(phase: number, ready = 1): Pose {
  const b = Math.sin(phase) * 0.03 * (1 - ready * 0.6);
  const relaxed: Pose = {
    pelvis: [0, 3.02 + b, 0],
    pelvisRot: [0.04, 0, 0],
    chestRot: [0.06, 0, 0],
    handR: [-0.85, 2.85 + b, 0.35],
    handL: [0.8, 3.0 + b, 0.55],
    footR: [-0.75, 0.2, 0],
    footL: [0.75, 0.2, 0.1],
    footYawR: 0.25,
    footYawL: -0.25,
  };
  const crouch: Pose = {
    pelvis: [0, 2.55 + b, -0.1],
    pelvisRot: [0.32, 0, 0],
    chestRot: [0.42, 0, 0],
    handR: [-0.45, 2.35 + b, 1.25],
    handL: [0.5, 2.3 + b, 1.45],
    footR: [-1.25, 0.2, 0],
    footL: [1.25, 0.2, 0.1],
    footYawR: 0.35,
    footYawL: -0.35,
  };
  return lerpPose(relaxed, crouch, Math.max(0, Math.min(1, ready)));
}

// ---------------------------------------------------------------------------
// Running, fielding and throwing

/**
 * Sprint cycle. `phase` advances with distance run (2π per two strides); `amt` 0..1 is
 * how hard he's running. Each foot plants in front, pushes back under the body, then
 * kicks up behind and drives the knee through; the arms pump opposite the legs.
 */
export function runPose(phase: number, amt: number): Pose {
  const a = Math.max(0, Math.min(1, amt));
  const stride = 0.55 + 0.85 * a;
  const kick = 0.3 + 0.8 * a;
  const foot = (ph: number): [number, number] => {
    const u = (((ph / (Math.PI * 2)) % 1) + 1) % 1;
    if (u < 0.4) {
      // Stance: foot on the ground sliding back from in front to behind.
      return [0.2, stride - (2 * stride * u) / 0.4];
    }
    // Swing: heel kicks up behind, then the knee drives forward.
    const w = (u - 0.4) / 0.6;
    const z = -stride + 2 * stride * (w * w * (3 - 2 * w));
    const y = 0.2 + kick * Math.sin(Math.PI * w) * (w < 0.5 ? 1 : 0.85);
    return [y, z];
  };
  const [yR, zR] = foot(phase);
  const [yL, zL] = foot(phase + Math.PI);
  const s = Math.sin(phase);
  const bob = Math.cos(phase * 2) * 0.07 * a;
  // Arms bent about 90°, pumping forward/back and rising as they come forward.
  const arm = (dir: number): [number, number] => [3.75 + 0.35 * a * Math.max(0, dir), 0.35 + 0.95 * a * dir];
  const [hyR, hzR] = arm(-s);
  const [hyL, hzL] = arm(s);
  return {
    pelvis: [0, 2.98 - 0.12 * a + bob, 0.05 * a],
    pelvisRot: [0.1 + 0.1 * a, s * 0.12 * a, 0],
    chestRot: [0.12 + 0.2 * a, -s * 0.18 * a, 0],
    footR: [-0.34, yR, zR],
    footL: [0.34, yL, zL],
    handR: [-0.82, hyR, hzR],
    handL: [0.82, hyL, hzL],
  };
}

/**
 * Glove (left hand) reaching for the ball at a point in the fielder's own space, over
 * a base pose (running or set). Low balls bend him down; high ones stretch him up.
 */
export function reachPose(base: Pose, ball: [number, number, number]): Pose {
  const [bx, by, bz] = ball;
  const low = by < 2.2;
  const high = by > 6;
  // Keep the glove within arm's reach of the left shoulder.
  const sx = 0.74;
  const sy = low ? 3.9 : high ? 5.2 : 4.6;
  let dx = bx - sx;
  let dy = by - sy;
  let dz = bz - 0.1;
  const len = Math.hypot(dx, dy, dz);
  const maxLen = 2.0;
  if (len > maxLen) {
    dx *= maxLen / len;
    dy *= maxLen / len;
    dz *= maxLen / len;
  }
  const glove: [number, number, number] = [sx + dx, sy + dy, Math.max(0.4, 0.1 + dz)];
  const p: Pose = { ...base, handL: glove };
  if (low) {
    p.pelvis = [base.pelvis[0], Math.min(base.pelvis[1], 2.35), base.pelvis[2]];
    p.pelvisRot = [0.45, base.pelvisRot[1], 0];
    p.chestRot = [0.6, base.chestRot[1], 0];
    // Throwing hand comes over to cover the glove on a grounder.
    p.handR = [glove[0] - 0.45, glove[1] + 0.25, glove[2] - 0.05];
  } else if (high) {
    p.chestRot = [-0.1, base.chestRot[1], 0];
    p.handR = [glove[0] - 0.5, glove[1] - 0.3, glove[2] - 0.1];
  }
  return p;
}

/** Laying out for a ball: arms stretched ahead, legs trailing (the root is tipped forward by the caller). */
export function divePose(): Pose {
  return {
    pelvis: [0, 3.0, 0],
    pelvisRot: [0.05, 0, 0],
    chestRot: [0.1, 0, 0],
    handR: [-0.35, 6.1, 0.6],
    handL: [0.35, 6.3, 0.8],
    footR: [-0.45, 0.35, -0.5],
    footL: [0.45, 0.6, -0.9],
  };
}

/** Ball in hand after a catch: glove and throwing hand together at the chest. */
export function transferPose(): Pose {
  return {
    pelvis: [0, 2.85, 0],
    pelvisRot: [0.12, -0.25, 0],
    chestRot: [0.15, -0.35, 0],
    handR: [-0.15, 4.45, 0.95],
    handL: [0.25, 4.35, 1.05],
    footR: [-0.7, 0.2, -0.2],
    footL: [0.7, 0.2, 0.4],
    footYawR: 0.4,
    footYawL: -0.1,
  };
}

/** Reaching down to pick up a ball on the ground in front of him. */
export function pickupPose(): Pose {
  return {
    pelvis: [0, 2.2, -0.2],
    pelvisRot: [0.5, 0, 0],
    chestRot: [0.75, 0, 0],
    handR: [-0.3, 0.9, 1.9],
    handL: [0.3, 0.7, 2.0],
    footR: [-1.0, 0.2, -0.2],
    footL: [1.0, 0.2, 0.5],
  };
}

/** Reaching with the glove at a given height straight ahead. */
export function catchPose(height: number): Pose {
  return reachPose(fielderReadyPose(0, 0.6), [0.4, Math.max(0.6, Math.min(6.8, height)), 1.6]);
}

/**
 * Crow-hop throw, t 0..1 (release around 0.55): step toward the target, arm up and
 * back, whip it over the top, follow through across the body.
 */
export function throwPose(t: number): Pose {
  const k = Math.min(1, Math.max(0, t));
  const cock = Math.min(1, k / 0.45);
  const fire = Math.max(0, Math.min(1, (k - 0.45) / 0.2));
  const follow = Math.max(0, (k - 0.65) / 0.35);
  const hand: [number, number, number] =
    k < 0.45
      ? [-0.6 - 0.7 * cock, 4.4 + 1.3 * cock, 0.6 - 2.0 * cock]
      : k < 0.65
        ? [-1.3 + 1.0 * fire, 5.7 - 0.1 * fire, -1.4 + 3.2 * fire]
        : [-0.3 + 0.9 * follow, 5.6 - 2.8 * follow, 1.8 - 0.3 * follow];
  return {
    pelvis: [0, 2.9 - 0.25 * fire, 0.2 + 0.5 * fire],
    pelvisRot: [0.1 + 0.25 * fire, -0.8 * (1 - fire) + 0.35 * fire, 0],
    chestRot: [0.05 + 0.55 * fire, -0.75 * (1 - fire) + 0.7 * fire, 0],
    footR: [-0.5, 0.2 + 0.5 * follow, -0.7 + 0.9 * follow],
    footL: [0.45, 0.2 + 0.4 * cock * (1 - fire), 0.4 + 1.1 * Math.max(cock * 0.6, fire)],
    handR: hand,
    // The glove arm points at the target, then tucks.
    handL: [0.9 - 0.5 * fire, 4.7 - 1.2 * fire, 1.4 - 0.6 * fire],
  };
}

/** Runner leading off a base. */
export const LEADOFF_POSE: Pose = {
  pelvis: [0, 2.7, 0],
  pelvisRot: [0.2, 0, 0],
  chestRot: [0.35, 0, 0],
  handR: [-0.9, 2.6, 0.6],
  handL: [0.9, 2.6, 0.6],
  footR: [-1.2, 0.2, 0],
  footL: [1.2, 0.2, 0],
};
