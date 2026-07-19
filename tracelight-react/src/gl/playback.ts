/**
 * Pure per-request playback state machine — no Pixi here, unit-testable in isolation.
 *
 * Each active request (traceId) owns a Playback: a FIFO queue of hops drained on a display
 * clock. A hop finishes before the next one starts, so a burst of near-simultaneous backend
 * events still plays back one hop at a time in arrival (== backend) order.
 */

import { cubicBezier, type Point } from './geometry';
import { HOP_DISTANCE_FACTOR, HOP_MAX_MS, HOP_MIN_MS } from './constants';

/** One edge traversal to play. The terminal "Return <entry>" hop is a regular edge too. */
export interface Hop {
  from: string;
  to: string;
}

/** Resolved world-space trajectory of a hop (cubic bezier) plus its endpoint distance. */
export interface HopGeom {
  start: Point;
  c1: Point;
  c2: Point;
  end: Point;
  dist: number;
}

interface ActiveHop {
  hop: Hop;
  geom: HopGeom;
  t: number;
  dur: number;
}

export interface Playback {
  queue: Hop[];
  active: ActiveHop | null;
  /** Set when the request's `close` event arrived — evict once the queue drains. */
  closing: boolean;
  /** Display-clock time of the last playback activity, for the missed-close TTL. */
  lastActivityMs: number;
}

/**
 * Maps a hop to its world trajectory at pop time. `null` drops the hop (an endpoint is
 * unknown); `'defer'` stalls the queue without consuming the hop (an endpoint is being
 * dragged — playback resumes when the drag ends).
 */
export type HopResolver = (hop: Hop) => HopGeom | null | 'defer';

/** Display duration of one hop: distance-scaled, clamped so speed feels uniform. */
export function hopDuration(dist: number): number {
  return Math.min(HOP_MAX_MS, Math.max(HOP_MIN_MS, dist * HOP_DISTANCE_FACTOR));
}

export function createPlayback(nowMs: number): Playback {
  return { queue: [], active: null, closing: false, lastActivityMs: nowMs };
}

export function enqueue(pb: Playback, hop: Hop, nowMs: number): void {
  pb.queue.push(hop);
  pb.lastActivityMs = nowMs;
}

/** True once the queue is drained and nothing is in flight. */
export function isDone(pb: Playback): boolean {
  return pb.active === null && pb.queue.length === 0;
}

/**
 * Advances playback by `dtMs` with linear time (no easing — hops are too short for it to
 * read well) and returns the dot's current position, or null when idle. Leftover dt at a
 * hop boundary carries into the next hop, so motion is continuous and total time stays
 * exact. `onComplete` fires once per finished hop (in order), for arrival effects.
 */
export function advance(
  pb: Playback,
  dtMs: number,
  resolve: HopResolver,
  nowMs: number,
  onComplete?: (hop: Hop) => void,
  durationFor?: (hop: Hop, dist: number) => number,
): { point: Point; hop: Hop } | null {
  let remaining = dtMs;
  let lastFinished: ActiveHop | null = null;

  for (;;) {
    if (!pb.active) {
      const next = pb.queue[0];
      // Queue drained (or stalled by a drag): rest on the endpoint of the hop that just
      // finished this frame, or report idle.
      if (!next) return atEnd(lastFinished);
      const geom = resolve(next);
      if (geom === 'defer') return atEnd(lastFinished);
      pb.queue.shift();
      if (!geom) continue; // endpoint unknown (node vanished) — drop the hop
      const dur = durationFor ? durationFor(next, geom.dist) : hopDuration(geom.dist);
      pb.active = { hop: next, geom, t: 0, dur };
      pb.lastActivityMs = nowMs;
    }

    const a = pb.active;
    a.t += remaining / a.dur;
    if (a.t < 1) {
      const { start, c1, c2, end } = a.geom;
      return { point: cubicBezier(start, c1, c2, end, a.t), hop: a.hop };
    }

    // Hop finished mid-frame: carry the overshoot into the next hop.
    remaining = (a.t - 1) * a.dur;
    lastFinished = a;
    pb.active = null;
    pb.lastActivityMs = nowMs;
    onComplete?.(a.hop);
  }
}

function atEnd(a: ActiveHop | null): { point: Point; hop: Hop } | null {
  return a ? { point: a.geom.end, hop: a.hop } : null;
}

/** Evict when closed-and-drained, or idle past `ttlMs` (safety net for a missed close). */
export function shouldEvict(pb: Playback, nowMs: number, ttlMs: number): boolean {
  if (!isDone(pb)) return false;
  return pb.closing || nowMs - pb.lastActivityMs > ttlMs;
}
