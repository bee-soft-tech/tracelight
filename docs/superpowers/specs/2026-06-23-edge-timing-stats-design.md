# Edge timing stats (min/avg/max) — design

**Date:** 2026-06-23
**Status:** approved, pending implementation plan

## Goal

Show the latency **between** trace points — `min / avg / max` time — as a label
rendered over the connecting edge of the live graph. This makes Tracelight not
just "where is the request now" but also "how long the hop from A to B takes".

## Definition of an edge's latency

For a single trace, the latency attributed to edge `A → B` is the wall-clock time
between the hit on `A` and the consecutive hit on `B`, computed from the existing
`ThreadLocal` sequence (`previous hit → current hit = edge`).

The entry hop `ENTRY → firstPoint` is timed from the moment the request enters
(`TraceContext.start()`) to the first point hit — a meaningful "time to first
point" value.

## Aggregation scope

**Cumulative since the last `reset`.** Consistent with how hit counters already
work; the same "reset" button/event zeroes both counters and timing. No rolling
window, no time window, no percentiles/histograms (explicit YAGNI).

## Backend

### `TraceContext`
- Add `long lastHitNanos`.
- Set to `System.nanoTime()` in `start()` and after every hit.
- Accessors `lastHitNanos()` / `lastHitNanos(long)`.

### `DefaultTraceRecorder.hit`
- Compute `now = System.nanoTime()`; `elapsed = (ctx != null) ? now - ctx.lastHitNanos() : -1`.
- Pass `elapsed` into `registry.recordHit(name, from, elapsedNanos)`.
- After recording: `ctx.currentNodeId(name)` and `ctx.lastHitNanos(now)`.

### `GraphRegistry.EdgeState` — timing aggregation (thread-safe)
- Fields: `LongAccumulator min(Math::min, MAX)`, `LongAccumulator max(Math::max, MIN)`,
  `LongAdder sumNanos`, `LongAdder samples`.
- `recordTiming(long nanos)` updates all four (ignored when `nanos < 0`).
- Accessors return **milliseconds**: `minMs()`, `maxMs()`, `avgMs()` (= `sum/samples`,
  `0` when `samples == 0`), plus `samples()`.
- `recordHit(name, from, elapsedNanos)` resolves the edge (existing or new) and
  calls `edge.recordTiming(elapsedNanos)`.
- Add `EdgeState edge(String id)` accessor (mirrors existing `node(String id)`).

### `GraphRegistry.resetCounters`
- Extend to also reset every edge's timing accumulators (min/max → identity,
  sum/samples → 0), so the live "reset" clears timing too.

### `TracelightBroadcaster` — wire format
Timing rides on the events that already carry edges; no new event type.
- `edgeJson(...)`: include `min`, `avg`, `max` (milliseconds) and `samples`
  **only when `samples > 0`**. Used by `snapshot` and `topology`.
- `flush()` (batch mode): for each active edge, read `registry.edge(id)` and add
  `min/avg/max` to the batch edge object.
- immediate mode `pulse`: add `min/avg/max` read from `registry.edge(edgeId)`.

## Frontend

### `types.ts`
- `TLEdge` gains optional `min?`, `avg?`, `max?`, `samples?` (milliseconds).
- `PulseEvent` and `BatchEvent` edges carry the same optional fields.

### `useTracelight`
- `snapshot` / `topology`: stats already flow through the existing `{...e}` spread.
- `pulse`: update the stored edge (`edgesRef`, keyed by `from->to`) with `min/avg/max`.
- `batch`: in addition to driving the flash animation, persist each edge's
  `min/avg/max` into `edgesRef`.
- `reset`: clear edge timing (drop `min/avg/max/samples`) so labels disappear.

### `TraceGraph`
- Pass `min/avg/max` into each React Flow edge's `data`.
- No relayout impact: the layout effect is keyed on `structuralKey` (node/edge ids
  only), so timing updates never trigger a re-layout — only the cheap `rfEdges`
  memo recomputes.

### `PulseEdge`
- Render a label at the path midpoint via `EdgeLabelRenderer`: `min / avg / max ms`.
- Format: value `< 10 ms` → one decimal place; otherwise integer.
- Render the label only when `samples > 0`. The flash overlay behaviour is unchanged.

## Out of scope (YAGNI)
- Percentiles / histograms.
- Rolling or time-based windows.
- A dedicated "timing" WS event — stats piggyback on existing traffic.
- Per-trace timing history (Tracelight stays live-only, no history).
