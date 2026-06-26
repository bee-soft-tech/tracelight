# Exception nodes + stacktrace — design

**Date:** 2026-06-26
**Status:** approved, pending implementation

## Goal

When an exception is thrown at a point in the code, show it on the graph as an extra **red
node** with the exception's short name and its own counter, connected from the node where it
was thrown. Clicking a red node opens a **panel** with the message + stacktrace.

## Decisions

- **Sources:** automatic via `@AfterThrowing` on `@TracePoint` methods, **plus** a manual
  `Tracelight.error(Throwable)` API (like `hit()`), for `catch` blocks / branches.
- **Node model:** one red node per **(throwing point + exception type)** — id `from!SimpleName`,
  `kind="error"`, label = exception simple name (e.g. `IllegalStateException`).
- **Stacktrace:** captured on first occurrence; message + top ~10 frames stored on the node and
  sent over the wire. Later occurrences of the same (place+type) only bump the counter.
- **Presentation:** click a red node → a panel (in the web app) shows message + stacktrace.
  Both renderers report the click via a callback; the panel lives in the consumer app.

## Backend

### `Tracelight.error(Throwable t)`
Static entry point; no-op until a `TraceRecorder` is wired (same pattern as `hit`).

### `TraceRecorder.error(Throwable t)` / `DefaultTraceRecorder`
- Read `TraceContext`; `from = currentNodeId`.
- **Dedup:** `TraceContext` remembers the last recorded `Throwable` (by identity). If `t` is the
  same object (already recorded deeper in the stack), skip — so a single exception unwinding
  through several `@TracePoint` methods produces **one** error node at the deepest point.
- Extract `simpleName = t.getClass().getSimpleName()`, `message = t.getMessage()`, and the top
  ~10 stack frames as strings.
- Call `registry.recordError(from, simpleName, message, frames)`; broadcast topology (+ pulse).
- Does **not** advance `currentNodeId` (an error is a leaf; the request unwinds).

### `TracePointAspect`
Add `@AfterThrowing(pointcut="@annotation(tracePoint)", throwing="ex")` → `recorder.error(ex)`.
The existing `@Before` already set `currentNodeId` to this method's node, so the error attaches
to the method that threw.

### `GraphRegistry`
- New `NodeState` fields for error nodes: `message`, `stack` (`List<String>`), set on first sight.
- `recordError(from, simpleName, message, frames)`: ensure `from` node, create/find the error
  node `from + "!" + simpleName` with `kind="error"` (storing message/stack on creation), create
  edge `from → errorNode`, increment its counter. Returns a result for the broadcaster.
- `resetCounters()` already zeroes every node counter, including error nodes (keep topology).

### `TracelightBroadcaster`
- `nodeJson`: for `kind="error"` nodes, include `message` and `stack` (array of strings).
- Error flows through the existing topology + pulse path; no new event type.

## Frontend

### `types.ts`
- `TLNode.kind` gains `'error'`; add optional `message?: string`, `stack?: string[]`.

### Renderers
- **React Flow** (`DefaultNode` + CSS): `.tl-node--error` red styling. `<TraceGraph>` gains
  `onErrorSelect?(node)`, wired through React Flow's `onNodeClick` (fires only for `kind==='error'`).
- **WebGL** (`scene.ts`): error palette (red fill/border/text) + a branch in `createNodeView`.
  A click (pointer down→up with no drag) on an error node calls an `onErrorSelect` callback
  passed via scene options; `<TraceGraphGL>` forwards it.

### Web app (`App.tsx`)
- Hold `selectedError` state; render a **stacktrace panel** (message + monospace, scrollable
  stack, close button) when set. Both renderers feed it through `onErrorSelect`. Dark-mode aware.

## Demo

`tracelight-demo-app` currently never throws. Make `payment` throw an `IllegalStateException`
under a clear condition (e.g. a specific amount), so the red node + panel are demonstrable.

## Testing

- **Backend (TDD):** `recordError` creates an `error` node with message/stack, edge, counter;
  `resetCounters` zeroes it; **dedup** — the same `Throwable` records once across nested points.
- **Frontend:** project convention (typecheck + build) plus live verification via Playwright
  (screenshot the red node and the open stacktrace panel).

## Out of scope (YAGNI)
- Updating the stored stacktrace on later occurrences (first one wins).
- Red error dots / distinct error-flow animation (the node carries the red signal).
- Grouping/aggregating errors, alerting, full-trace error correlation.
