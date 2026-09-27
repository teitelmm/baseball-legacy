import { BALL_RADIUS, PLATE_HALF_WIDTH, ZONE_BOTTOM, ZONE_TOP } from '../core/constants';
import type { PlateLoc } from '../core/types';

/** A pitch is a strike if any part of the ball touches the zone. */
export function isStrike(loc: PlateLoc): boolean {
  return (
    Math.abs(loc.x) <= PLATE_HALF_WIDTH + BALL_RADIUS &&
    loc.y >= ZONE_BOTTOM - BALL_RADIUS &&
    loc.y <= ZONE_TOP + BALL_RADIUS
  );
}

/** How far outside the zone (ft); 0 or negative when inside. */
export function distanceOutsideZone(loc: PlateLoc): number {
  const dx = Math.abs(loc.x) - (PLATE_HALF_WIDTH + BALL_RADIUS);
  const dy = Math.max(ZONE_BOTTOM - BALL_RADIUS - loc.y, loc.y - (ZONE_TOP + BALL_RADIUS));
  if (dx <= 0 && dy <= 0) return Math.max(dx, dy);
  return Math.hypot(Math.max(0, dx), Math.max(0, dy));
}
