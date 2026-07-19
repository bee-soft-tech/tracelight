/**
 * Pure layout for the Zipkin-style waterfall — no React, unit-testable in isolation.
 *
 * A captured request is a *linear* chain of hops (Tracelight has no call-stack nesting), so the
 * "tree" is really a timeline: each hop becomes a bar that starts where the preceding hops ended.
 */

import type { RecordedTrace, ReplayHop } from './types';

/** One hop laid out on the horizontal timeline. */
export interface WaterfallRow {
  from: string;
  to: string;
  /** This hop's latency in ms, or undefined when the server never timed it. */
  ms?: number;
  /** Start offset from the request's beginning (ms) — sum of preceding hops' known latencies. */
  offsetMs: number;
  /** Bar length in ms — the hop's own `ms`, or 0 when unknown. */
  widthMs: number;
}

export interface WaterfallLayout {
  rows: WaterfallRow[];
  /** Span used to scale bars to a 0..1 fraction. Never 0, so callers can divide safely. */
  totalMs: number;
}

/**
 * Lay a captured request's hop chain onto a waterfall. Hops the server never timed (`ms`
 * undefined) take zero width but still advance a row, so they stay visible as markers.
 */
export function waterfallLayout(trace: RecordedTrace): WaterfallLayout {
  let cursor = 0;
  const rows: WaterfallRow[] = trace.hops.map((h: ReplayHop) => {
    const widthMs = h.ms ?? 0;
    const row: WaterfallRow = { from: h.from, to: h.to, ms: h.ms, offsetMs: cursor, widthMs };
    cursor += widthMs;
    return row;
  });
  // Scale to whichever is larger: the recorded total or the summed cursor (equal when every hop is
  // timed). `|| 1` guards an all-zero trace so a bar's `offset/total` never divides by zero.
  const totalMs = Math.max(trace.totalMs, cursor) || 1;
  return { rows, totalMs };
}
