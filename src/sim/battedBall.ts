import { BALL_RADIUS, fenceDistance, FOUL_ANGLE, GRAVITY, MPH_TO_FPS, WALL_HEIGHT } from '../core/constants';
import type { Vec3 } from '../core/types';

// Aerodynamics (feet, seconds). k = 0.5 * rho * A / m for a baseball at sea level.
const AERO_K = (0.5 * 0.002377 * Math.PI * BALL_RADIUS * BALL_RADIUS) / (5.125 / 16 / 32.174);
const DRAG_CD = 0.37;

/** Lift coefficient from backspin, which grows with launch angle (topspin below 0). */
export function liftCoefficient(launchAngleDeg: number): number {
  if (launchAngleDeg <= 0) return Math.max(-0.08, launchAngleDeg * 0.004);
  return Math.min(0.2, 0.075 + launchAngleDeg * 0.004);
}

export interface BattedBallInit {
  exitVeloMph: number;
  launchAngleDeg: number;
  sprayDeg: number;
  start: Vec3;
}

export interface BattedBallPath {
  init: BattedBallInit;
  /** Samples every DT seconds. */
  points: Vec3[];
  dt: number;
  /** Time and point of first contact with the ground (or wall top / stands for HRs). */
  landingTime: number;
  landing: Vec3;
  /** Horizontal distance from home plate at landing (ft). */
  distance: number;
  /** Max height (ft). */
  apex: number;
  /** True if the ball cleared the fence in fair territory. */
  homeRun: boolean;
  /** True if the ball hit the outfield wall on the fly. */
  hitWall: boolean;
  /** Total duration of the path including bounces and roll. */
  duration: number;
}

export const PATH_DT = 1 / 240;

function horizDist(p: Vec3): number {
  return Math.hypot(p.x, p.z);
}

export function sprayOf(p: Vec3): number {
  return (Math.atan2(p.x, -p.z) * 180) / Math.PI;
}

/**
 * Integrate a batted ball: flight with drag + Magnus lift, then simple bounces and roll.
 * Deterministic for a given init.
 */
export function simulateBattedBall(init: BattedBallInit, maxTime = 10): BattedBallPath {
  const dt = PATH_DT;
  const v = init.exitVeloMph * MPH_TO_FPS;
  const la = (init.launchAngleDeg * Math.PI) / 180;
  const sp = (init.sprayDeg * Math.PI) / 180;
  const dir = { x: Math.sin(sp), z: -Math.cos(sp) };
  const vel = { x: v * Math.cos(la) * dir.x, y: v * Math.sin(la), z: v * Math.cos(la) * dir.z };
  const pos = { ...init.start };
  const cl = liftCoefficient(init.launchAngleDeg);
  // Backspin axis is horizontal, perpendicular to the direction of travel. Lift = axis x v.
  const axis = { x: -dir.z, y: 0, z: dir.x };
  // Sign so that lift points up for a ball travelling forward and up.
  const liftSign = 1;

  const points: Vec3[] = [{ ...pos }];
  let landingTime = -1;
  let landing: Vec3 = { ...pos };
  let apex = pos.y;
  let homeRun = false;
  let hitWall = false;
  let airborne = true;
  let t = 0;
  let bounces = 0;
  let spin = 1;

  const fair = Math.abs(init.sprayDeg) <= FOUL_ANGLE;

  while (t < maxTime) {
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    if (airborne) {
      const drag = AERO_K * DRAG_CD * speed;
      const lift = AERO_K * cl * spin * speed;
      // axis x vel
      const cx = axis.y * vel.z - axis.z * vel.y;
      const cy = axis.z * vel.x - axis.x * vel.z;
      const cz = axis.x * vel.y - axis.y * vel.x;
      const ax = -drag * vel.x + liftSign * lift * cx;
      const ay = -GRAVITY - drag * vel.y + liftSign * lift * cy;
      const az = -drag * vel.z + liftSign * lift * cz;
      vel.x += ax * dt;
      vel.y += ay * dt;
      vel.z += az * dt;
    } else {
      // Rolling: friction slows the ball.
      const decel = 12 * dt;
      const hs = Math.hypot(vel.x, vel.z);
      const ns = Math.max(0, hs - decel);
      const f = hs > 0 ? ns / hs : 0;
      vel.x *= f;
      vel.z *= f;
      vel.y = 0;
    }

    const prevDist = horizDist(pos);
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;
    t += dt;
    apex = Math.max(apex, pos.y);

    // Fence: the ball crosses the wall line in fair territory.
    const dist = horizDist(pos);
    const spray = sprayOf(pos);
    if (Math.abs(spray) <= FOUL_ANGLE) {
      const fence = fenceDistance(spray);
      if (prevDist < fence && dist >= fence) {
        if (pos.y > WALL_HEIGHT && landingTime < 0 && fair) {
          homeRun = true;
        } else if (pos.y <= WALL_HEIGHT) {
          // Bounce off the wall.
          if (landingTime < 0) hitWall = true;
          const nx = pos.x / dist;
          const nz = pos.z / dist;
          const vn = vel.x * nx + vel.z * nz;
          vel.x -= 1.6 * vn * nx;
          vel.z -= 1.6 * vn * nz;
          pos.x = nx * (fence - 0.5);
          pos.z = nz * (fence - 0.5);
        }
      }
    }

    if (pos.y <= BALL_RADIUS && vel.y < 0) {
      pos.y = BALL_RADIUS;
      if (landingTime < 0) {
        landingTime = t;
        landing = { ...pos };
      }
      bounces++;
      spin = 0;
      if (Math.abs(vel.y) > 4 && bounces < 8) {
        vel.y = -vel.y * 0.42;
        vel.x *= 0.72;
        vel.z *= 0.72;
      } else {
        airborne = false;
      }
    }

    points.push({ ...pos });

    if (homeRun && pos.y < 0) break;
    if (!airborne && Math.hypot(vel.x, vel.z) < 0.5) break;
  }

  if (landingTime < 0) {
    landingTime = t;
    landing = { ...pos };
  }

  return {
    init,
    points,
    dt,
    landingTime,
    landing,
    distance: horizDist(landing),
    apex,
    homeRun,
    hitWall,
    duration: t,
  };
}

export function pathPositionAt(path: BattedBallPath, t: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const f = Math.max(0, t) / path.dt;
  const i = Math.min(path.points.length - 1, Math.floor(f));
  const j = Math.min(path.points.length - 1, i + 1);
  const u = f - Math.floor(f);
  const a = path.points[i];
  const b = path.points[j];
  out.x = a.x + (b.x - a.x) * u;
  out.y = a.y + (b.y - a.y) * u;
  out.z = a.z + (b.z - a.z) * u;
  return out;
}
