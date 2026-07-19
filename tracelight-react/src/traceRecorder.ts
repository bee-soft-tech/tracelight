/**
 * Pure per-session request recorder — no React here, unit-testable in isolation.
 *
 * Fed the raw lifecycle/pulse stream (immediate mode only, where each request has a `traceId`),
 * it demultiplexes concurrent requests by `traceId` and, on each `close`, emits the finished
 * request as a {@link RecordedTrace}. Stale in-flight buffers (a missed `close`) are evicted by
 * TTL so a long session doesn't leak.
 */

import type { RecordedTrace, ReplayHop } from './types';

interface Inflight {
  entry: string;
  hops: ReplayHop[];
  lastMs: number;
}

/** Drop an in-flight request whose `close` never arrived after this much idle time. */
const INFLIGHT_TTL_MS = 60_000;

export class TraceRecorder {
  private readonly inflight = new Map<string, Inflight>();
  private seq = 0;

  /** A request started: begin buffering its hops. Re-opening a live id restarts it. */
  open(traceId: string, entry: string, nowMs: number): void {
    this.inflight.set(traceId, { entry, hops: [], lastMs: nowMs });
    this.evictStale(nowMs);
  }

  /**
   * One hop of a request. Tolerates a missing `open` (buffers lazily) so a request already in
   * flight when recording starts is still captured from its first observed hop; `entry` is then
   * seeded from the hop's source.
   */
  pulse(traceId: string, from: string, to: string, ms: number | undefined, nowMs: number): void {
    let f = this.inflight.get(traceId);
    if (!f) {
      f = { entry: from, hops: [], lastMs: nowMs };
      this.inflight.set(traceId, f);
    }
    f.hops.push({ from, to, ms });
    f.lastMs = nowMs;
  }

  /**
   * A request finished: return the completed trace (or null if nothing was buffered / already
   * closed). The caller assigns it into its list.
   */
  close(traceId: string, at: number): RecordedTrace | null {
    const f = this.inflight.get(traceId);
    if (!f) return null;
    this.inflight.delete(traceId);
    if (f.hops.length === 0) return null; // a request that hit no @TracePoint — nothing to replay
    const totalMs = f.hops.reduce((sum, h) => sum + (h.ms ?? 0), 0);
    return { id: this.seq++, entry: f.entry, hops: f.hops, totalMs, at };
  }

  /** Drop in-flight buffers idle past the TTL (missed close). */
  private evictStale(nowMs: number): void {
    for (const [id, f] of this.inflight) {
      if (nowMs - f.lastMs > INFLIGHT_TTL_MS) this.inflight.delete(id);
    }
  }
}
