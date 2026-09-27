import type { Keyframes, Pose } from './humanoid';

// All poses are in the model's root space: it faces +z and its right side is -x.
// Batter: the plate is +z, the pitcher +x (mirrored for lefties).
// Pitcher: the plate is +z. Catcher / fielders: home plate is +z.

export const BATTER_STANCE: Pose = {
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

export const BATTER_LOAD: Pose = {
  ...BATTER_STANCE,
  pelvis: [-0.25, 2.9, 0],
  pelvisRot: [0, -0.3, 0],
  chestRot: [0.12, -0.4, 0],
  footL: [1.15, 0.45, 0.1],
  bat: { h: [-0.75, 4.4, 0.45], yaw: 205, pitch: 50 },
};

export const SWING_CONTACT_T = 0.15;
export const SWING_DURATION = 0.75;
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
  return [
    [0, BATTER_LOAD],
    [0.06, stride],
    [0.11, launch],
    [SWING_CONTACT_T, contact],
    [0.22, extend],
    [0.4, finish],
    [SWING_DURATION, finish],
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
  return [
    [0, PITCHER_SET],
    [0.3, PITCHER_SET],
    [0.55, pivot],
    [0.8, lift],
    [1.0, stride],
    [1.18, plant],
    [WINDUP_DURATION, release],
    [1.55, follow],
    [PITCH_ANIM_DURATION, ready],
  ];
}

export function pitcherSetPose(): Pose {
  return PITCHER_SET;
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

export function fielderReadyPose(phase: number): Pose {
  const b = Math.sin(phase) * 0.03;
  return {
    pelvis: [0, 2.7 + b, 0],
    pelvisRot: [0.15, 0, 0],
    chestRot: [0.35, 0, 0],
    handR: [-0.75, 2.5 + b, 0.9],
    handL: [0.75, 2.5 + b, 0.9],
    footR: [-1.05, 0.2, 0],
    footL: [1.05, 0.2, 0],
    footYawR: 0.3,
    footYawL: -0.3,
  };
}
