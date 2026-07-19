/** A point in the code (a graph node). */
export interface TLNode {
  id: string;
  label: string;
  kind: 'entry' | 'point' | 'error';
  count: number;
  /** Exception message — present only on `error` nodes. */
  message?: string;
  /** Top stack frames — present only on `error` nodes. */
  stack?: string[];
}

/** Cumulative latency of crossing an edge, in milliseconds, since the last reset. */
export interface TLEdgeTiming {
  /** Fastest observed traversal (ms). */
  min: number;
  /** Mean traversal (ms). */
  avg: number;
  /** Slowest observed traversal (ms). */
  max: number;
  /** Number of timed samples. */
  samples: number;
}

/** A directed transition between two points, discovered from traffic. */
export interface TLEdge extends Partial<TLEdgeTiming> {
  id: string;
  from: string;
  to: string;
}

export interface SnapshotEvent {
  type: 'snapshot';
  nodes: TLNode[];
  edges: TLEdge[];
}

export interface TopologyEvent {
  type: 'topology';
  nodes?: TLNode[];
  edges?: TLEdge[];
}

export interface PulseEvent extends Partial<TLEdgeTiming> {
  type: 'pulse';
  traceId: string;
  from: string;
  to: string;
  count: number;
  /** This hop's own real latency in ms (immediate mode only) — drives slow-motion replay. */
  ms?: number;
}

/** One recorded edge traversal of a captured request, with its real latency when known. */
export interface ReplayHop {
  from: string;
  to: string;
  ms?: number;
}

/** A single request captured during a recording session, replayable in slow motion. */
export interface RecordedTrace {
  /** Monotonic id assigned at capture time. */
  id: number;
  /** Entry node id ("METHOD /path") — the route this request belongs to. */
  entry: string;
  /** Ordered hops the request crossed, terminal "Return <entry>" hop included. */
  hops: ReplayHop[];
  /** Sum of known per-hop latencies (ms). */
  totalMs: number;
  /** Wall-clock capture time (ms since epoch). */
  at: number;
}

/** Aggregated hits over one server-side flush window (heavy-traffic mode). */
export interface BatchEvent {
  type: 'batch';
  nodes: { id: string; count: number; delta: number }[];
  edges: ({ id: string; from: string; to: string; delta: number } & Partial<TLEdgeTiming>)[];
}

export interface ResetEvent {
  type: 'reset';
}

/**
 * The backend started monitoring a request (emitted by the request filter, immediate mode
 * only). A pure UI trigger — creates the request's playback queue; never a graph node.
 */
export interface OpenEvent {
  type: 'open';
  traceId: string;
  /** Entry node id ("METHOD /path"). */
  entry: string;
}

/**
 * The request finished (emitted in the filter's finally, immediate mode only). A pure UI
 * trigger — deletes the request's playback queue once it drains. The terminal hop into the
 * "Return <entry>" node arrives separately as a regular pulse just before this frame.
 */
export interface CloseEvent {
  type: 'close';
  traceId: string;
  /** Last node the request hit (informational); equals `to` when no @TracePoint fired. */
  from: string;
  /** Entry node id (informational). */
  to: string;
}

export type TracelightEvent =
  | SnapshotEvent
  | TopologyEvent
  | PulseEvent
  | BatchEvent
  | ResetEvent
  | OpenEvent
  | CloseEvent;
