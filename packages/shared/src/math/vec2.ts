export interface Vec2 {
  x: number;
  y: number;
}

export function vec2(x: number = 0, y: number = 0): Vec2 {
  return { x, y };
}

export function vec2Add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function vec2Sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function vec2Scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function vec2Len(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export function vec2Dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function vec2DistSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function vec2Norm(v: Vec2): Vec2 {
  const len = vec2Len(v);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function vec2Angle(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

export function vec2FromAngle(rad: number, len: number = 1): Vec2 {
  return { x: Math.cos(rad) * len, y: Math.sin(rad) * len };
}

export function vec2Lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function circleIntersectsCircle(
  c1: Vec2,
  r1: number,
  c2: Vec2,
  r2: number,
): boolean {
  const r = r1 + r2;
  return vec2DistSq(c1, c2) <= r * r;
}

export function pointInAABB(p: Vec2, min: Vec2, max: Vec2): boolean {
  return p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;
}

export function circleIntersectsAABB(
  circleCenter: Vec2,
  radius: number,
  min: Vec2,
  max: Vec2,
): boolean {
  const closestX = clamp(circleCenter.x, min.x, max.x);
  const closestY = clamp(circleCenter.y, min.y, max.y);
  const dx = circleCenter.x - closestX;
  const dy = circleCenter.y - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Resolves 2D collision between a moving circle (entity) and discrete 1x1 solid map tiles.
 * Supports sliding along walls smoothly.
 */
export function resolveCircleTileCollision(
  pos: Vec2,
  radius: number,
  isSolidTile: (tx: number, ty: number) => boolean,
): Vec2 {
  let resX = pos.x;
  let resY = pos.y;

  const minTX = Math.floor(resX - radius);
  const maxTX = Math.floor(resX + radius);
  const minTY = Math.floor(resY - radius);
  const maxTY = Math.floor(resY + radius);

  for (let ty = minTY; ty <= maxTY; ty++) {
    for (let tx = minTX; tx <= maxTX; tx++) {
      if (!isSolidTile(tx, ty)) continue;

      const tileMin = { x: tx, y: ty };
      const tileMax = { x: tx + 1, y: ty + 1 };

      const closestX = clamp(resX, tileMin.x, tileMax.x);
      const closestY = clamp(resY, tileMin.y, tileMax.y);

      const dx = resX - closestX;
      const dy = resY - closestY;
      const distSq = dx * dx + dy * dy;

      if (distSq < radius * radius && distSq > 0.000001) {
        const dist = Math.sqrt(distSq);
        const overlap = radius - dist;
        resX += (dx / dist) * overlap;
        resY += (dy / dist) * overlap;
      } else if (distSq <= 0.000001) {
        // Center is inside or exactly on tile edge
        resY += radius;
      }
    }
  }

  return { x: resX, y: resY };
}
