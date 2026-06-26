/** Pure geometry + a generic object pool. No Pixi here, so this is unit-testable in isolation. */

export interface Point {
  x: number;
  y: number;
}

/** Point a fraction `t` (0..1) along the segment a→b. */
export function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Endpoints of an edge between two nodes: the source's right-centre to the target's
 * left-centre (matching the left→right elk layout). Positions are node top-left corners;
 * {@code sourceWidth} is the source node's own width (nodes are sized to their content).
 */
export function edgeEndpoints(
  source: Point,
  target: Point,
  sourceWidth: number,
  h: number,
): { start: Point; end: Point } {
  return {
    start: { x: source.x + sourceWidth, y: source.y + h / 2 },
    end: { x: target.x, y: target.y + h / 2 },
  };
}

/**
 * Cubic-bezier control points for a left→right edge (source right-centre → target left-centre),
 * mimicking React Flow's bezier edges: handles pushed horizontally so lines leave/enter flat.
 */
export function bezierControls(start: Point, end: Point): { c1: Point; c2: Point } {
  const dx = Math.max(Math.abs(end.x - start.x) * 0.5, 30);
  return { c1: { x: start.x + dx, y: start.y }, c2: { x: end.x - dx, y: end.y } };
}

/** Point at parameter `t` (0..1) on the cubic bezier p0→c1→c2→p3. */
export function cubicBezier(p0: Point, c1: Point, c2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p3.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p3.y,
  };
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box of all node boxes (top-left positions plus per-node width and height). */
export function contentBounds(
  positions: Iterable<{ x: number; y: number; width: number }>,
  h: number,
): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const p of positions) {
    any = true;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.width);
    maxY = Math.max(maxY, p.y + h);
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

/** Scale + translation that fits `bounds` into a viewport with padding (capped at maxScale). */
export function fitTransform(
  bounds: Bounds,
  viewW: number,
  viewH: number,
  padding = 40,
  maxScale = 1.5,
): { scale: number; x: number; y: number } {
  const cw = Math.max(1, bounds.maxX - bounds.minX);
  const ch = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((viewW - 2 * padding) / cw, (viewH - 2 * padding) / ch, maxScale);
  const x = (viewW - cw * scale) / 2 - bounds.minX * scale;
  const y = (viewH - ch * scale) / 2 - bounds.minY * scale;
  return { scale, x, y };
}

/**
 * Generic object pool — reuses instances so the per-frame dot churn allocates nothing.
 * `factory` creates a fresh instance on a miss; callers reset state on acquire.
 */
export class Pool<T> {
  private readonly free: T[] = [];
  private readonly inUse = new Set<T>();

  constructor(private readonly factory: () => T) {}

  acquire(): T {
    const o = this.free.pop() ?? this.factory();
    this.inUse.add(o);
    return o;
  }

  release(o: T): void {
    if (this.inUse.delete(o)) this.free.push(o);
  }

  forEachActive(fn: (o: T) => void): void {
    this.inUse.forEach(fn);
  }

  get activeCount(): number {
    return this.inUse.size;
  }
}
