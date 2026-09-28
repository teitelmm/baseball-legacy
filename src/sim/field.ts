import { BASE_DISTANCE, fenceDistance, FOUL_ANGLE } from '../core/constants';
import type { FieldPosition } from '../core/types';

export interface XZ {
  x: number;
  z: number;
}

const R2 = Math.SQRT1_2;

/** Base positions: 0 = home, 1 = first, 2 = second, 3 = third. */
export const BASES: readonly XZ[] = [
  { x: 0, z: 0 },
  { x: BASE_DISTANCE * R2, z: -BASE_DISTANCE * R2 },
  { x: 0, z: -BASE_DISTANCE * Math.SQRT2 },
  { x: -BASE_DISTANCE * R2, z: -BASE_DISTANCE * R2 },
];

/** Default defensive spots. */
export const FIELD_SPOTS: Record<FieldPosition, XZ> = {
  P: { x: 0, z: -56 },
  C: { x: 0, z: 3.4 },
  '1B': { x: 58, z: -82 },
  '2B': { x: 30, z: -128 },
  SS: { x: -32, z: -128 },
  '3B': { x: -60, z: -84 },
  LF: { x: -150, z: -255 },
  CF: { x: 0, z: -312 },
  RF: { x: 150, z: -255 },
};

export function dist(a: XZ, b: XZ): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Direction (x, z) for a spray angle: 0 = center field (-z), + = right field (+x). */
export function sprayDir(angleDeg: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [Math.sin(a), -Math.cos(a)];
}

let cachedBoundary: Array<[number, number]> | null = null;

/**
 * The stadium's inner boundary polygon (x, z): the outfield fence from the left field
 * pole to the right field pole, down the right field foul wall, around the backstop,
 * and up the left field foul wall.
 */
export function stadiumBoundary(): Array<[number, number]> {
  if (cachedBoundary) return cachedBoundary;
  const foulOffset = 48;
  const [rlx, rlz] = sprayDir(FOUL_ANGLE);
  const outward: [number, number] = [R2, R2]; // away from fair territory on the right side

  const fence: Array<[number, number]> = [];
  for (let a = -FOUL_ANGLE; a <= FOUL_ANGLE + 1e-6; a += 3) {
    const [dx, dz] = sprayDir(a);
    const d = fenceDistance(a);
    fence.push([dx * d, dz * d]);
  }

  const rightWall: Array<[number, number]> = [];
  for (let s = 40; s <= 330; s += 29) {
    rightWall.push([rlx * s + outward[0] * foulOffset, rlz * s + outward[1] * foulOffset]);
  }
  const leftWall = rightWall.map(([x, z]) => [-x, z] as [number, number]);

  const backstop: Array<[number, number]> = [];
  for (let a = 135; a <= 225; a += 7.5) {
    const r = (a * Math.PI) / 180;
    backstop.push([Math.sin(r) * 62, -Math.cos(r) * 62]);
  }

  cachedBoundary = [...fence, ...rightWall.slice().reverse(), ...backstop, ...leftWall];
  return cachedBoundary;
}

export function pointInPolygon(p: XZ, poly: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > p.z !== zj > p.z && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function inPlayableArea(p: XZ): boolean {
  // Fast path: comfortably inside fair territory.
  if (p.z < -5) {
    const d = Math.hypot(p.x, p.z);
    if (d < 320 && Math.abs(p.x) < -p.z) return true;
  }
  return pointInPolygon(p, stadiumBoundary());
}
