/**
 * Pure radial minimum-distance resolution between node centers — no Pixi here,
 * unit-testable in isolation.
 *
 * The constraint is push-out, not blocking: the dragged node follows the cursor and is
 * projected out of each neighbor's forbidden radius every frame, so it slides smoothly
 * along the boundary instead of sticking.
 */

export interface Center {
  x: number;
  y: number;
}

/**
 * Projects `centers[movingId]` out of every other center's `minDist` radius, mutating it
 * in place. Runs `iterations` relaxation passes (escaping node A can push into node B).
 * Returns true when any push was applied — used to show the "constrained" highlight.
 * Exactly coincident nodes (d === 0) are left alone; there is no defined push direction.
 */
export function pushOutOne(
  centers: Map<string, Center>,
  movingId: string,
  minDist: number,
  iterations: number,
): boolean {
  const moving = centers.get(movingId);
  if (!moving) return false;
  let pushed = false;
  for (let i = 0; i < iterations; i++) {
    let any = false;
    for (const [id, n] of centers) {
      if (id === movingId) continue;
      const dx = moving.x - n.x;
      const dy = moving.y - n.y;
      const d = Math.hypot(dx, dy);
      if (d < minDist && d > 0) {
        const push = (minDist - d) / d;
        moving.x += dx * push;
        moving.y += dy * push;
        any = true;
        pushed = true;
      }
    }
    if (!any) break; // converged early
  }
  return pushed;
}

/**
 * Separates every pair of centers to at least `minDist`, mutating the map in place —
 * symmetric push (half each way), `iterations` passes over all pairs. Used once on load
 * to fix persisted/laid-out positions that are too close. Returns true if anything moved.
 */
export function relaxAll(
  centers: Map<string, Center>,
  minDist: number,
  iterations: number,
): boolean {
  const list = Array.from(centers.values());
  let moved = false;
  for (let i = 0; i < iterations; i++) {
    let any = false;
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const ca = list[a];
        const cb = list[b];
        const dx = cb.x - ca.x;
        const dy = cb.y - ca.y;
        const d = Math.hypot(dx, dy);
        if (d < minDist && d > 0) {
          const push = (minDist - d) / d / 2;
          ca.x -= dx * push;
          ca.y -= dy * push;
          cb.x += dx * push;
          cb.y += dy * push;
          any = true;
          moved = true;
        }
      }
    }
    if (!any) break;
  }
  return moved;
}
