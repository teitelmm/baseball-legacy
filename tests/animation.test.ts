import { describe, expect, it } from 'vitest';
import { BATTER_STANCE, batterSwingKeys, eyesOn } from '../src/scene/animations';
import { samplePose, type Keyframes, type Pose } from '../src/scene/humanoid';

const pose = (x: number): Pose => ({
  pelvis: [x, 3, 0],
  pelvisRot: [0, 0, 0],
  chestRot: [0, 0, 0],
  handR: [-1, 4, 0],
  handL: [1, 4, 0],
  footR: [-0.5, 0.2, 0],
  footL: [0.5, 0.2, 0],
});

describe('animation curves', () => {
  const keys: Keyframes = [
    [0, pose(0)],
    [1, pose(1)],
    [2, pose(2)],
  ];

  it('passes through every key', () => {
    for (const [t, p] of keys) expect(samplePose(keys, t).pelvis[0]).toBeCloseTo(p.pelvis[0], 6);
  });

  it('keeps moving through a key instead of stopping at it', () => {
    const x = (t: number) => samplePose(keys, t).pelvis[0];
    const speedAtKey = (x(1.01) - x(0.99)) / 0.02;
    expect(speedAtKey).toBeGreaterThan(0.8);
    // ...but eases out of the first key and into the last.
    expect((x(0.01) - x(0)) / 0.01).toBeLessThan(0.1);
    expect((x(2) - x(1.99)) / 0.01).toBeLessThan(0.1);
  });

  it('holds still on repeated keys', () => {
    const hold: Keyframes = [
      [0, pose(0)],
      [1, pose(0)],
      [2, pose(1)],
    ];
    expect(samplePose(hold, 0.5).pelvis[0]).toBeCloseTo(0, 6);
  });

  it('the batter keeps his eyes on the pitcher until contact', () => {
    // Eyes' yaw = hips + shoulders + head turn.
    const look = (p: Pose) => p.pelvisRot[1] + p.chestRot[1] + (p.headRot?.[1] ?? 0);
    // Toward the pitcher (+x, about 1.4 rad), as far as the neck turns.
    expect(look(BATTER_STANCE)).toBeGreaterThan(1.2);
    const keys = batterSwingKeys(1.2, 2.5);
    expect(look(keys[1][1])).toBeGreaterThan(1.2);
    // After contact the head comes around with the finish.
    expect(look(keys[keys.length - 1][1])).toBeGreaterThan(1.5);
    expect(eyesOn(BATTER_STANCE, 0).headRot![1]).toBeLessThanOrEqual(1.65);
  });
});
