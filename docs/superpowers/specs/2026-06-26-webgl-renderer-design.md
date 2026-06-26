# WebGL renderer (`TraceGraphGL`, PixiJS) — design

**Date:** 2026-06-26
**Status:** approved, experiment

## Goal

A second, WebGL-based renderer for the live graph, to compare performance against the
React Flow renderer — especially the hot path of many dots flowing along edges. Each
request shows as a dot travelling through the nodes (the original concept).

## Decisions

- **Library:** PixiJS v8 (batched 2D sprites, `BitmapText`, WebGL).
- **Scope of GL:** full — nodes, labels, edges and dots all in Pixi; nothing DOM in the canvas.
- **Integration:** new library component `TraceGraphGL`, selectable in the web app via a
  `React Flow | WebGL` segmented toggle (full canvas each — a fair perf comparison, not split-screen).
- **Same data + layout:** consumes the same `TracelightState` from `useTracelight` and reuses
  `layoutGraph` (elk-in-worker) with the same stable-position logic, so both renderers match 1:1.
- **Dot semantics:** one dot per `pulse`, travelling a single hop `from → to` over `flashMs`.
  A request's consecutive hops read as a dot flowing through the path. (Per-`traceId` continuous
  dots are a possible v2.)
- **Testing:** project convention (no FE test runner) — verify via typecheck/build + live FPS.
  Pure geometry/pool logic is isolated in `gl/geometry.ts` so it can be unit-tested later.

## Components

### `src/gl/geometry.ts` (pure, isolated)
- `lerp(a, b, t)` → point on the segment.
- `edgeEndpoints(source, target, w, h)` → start (source right-centre) and end (target left-centre).
- `fitTransform(bounds, viewport, padding)` → `{ scale, x, y }` to fit content on load.
- `DotPool` — acquire/release pooled dot records (no per-frame allocation).

### `src/TraceGraphGL.tsx` (imperative Pixi scene; React only mounts the canvas)
Props mirror `TraceGraph` where sensible: `graph`, `nodeWidth?`, `nodeHeight?`, `flashMs?`,
`colorMode?`, `showFps?`, `className?`, `style?`.

- **Init:** `new Application()` + `await app.init({ canvas, resizeTo: container, antialias,
  resolution: devicePixelRatio, autoDensity, background })`. Destroy on unmount.
- **Layers (Containers):** `edgesLayer`, `nodesLayer`, `dotsLayer`, plus a fixed `hud` (FPS).
- **Nodes:** per node a `Graphics` rounded-rect + `BitmapText` label + count + a status LED;
  positioned from elk. Counts updated when `graph.nodes` changes.
- **Edges:** `Graphics` lines source→target; green flash whose alpha decays in the ticker.
- **Dots:** on each `pulse`, acquire a pooled dot at the source, animate along the edge to the
  target over `flashMs`, then release. Pixi `ticker` lerps every live dot each frame.
- **Pan/zoom:** wheel-zoom (around pointer) and drag-pan on a root container; fit-to-content
  on first layout. No extra dependency.
- **Theme:** `colorMode` ('light' | 'dark' | 'system') maps to background/node/text/edge colors.
- **FPS:** `BitmapText` in a corner driven by `app.ticker.FPS`, so the comparison is measurable.

### `src/index.ts`
Export `TraceGraphGL` and its props type.

### `tracelight-web/src/App.tsx`
A `renderer` state (`'reactflow' | 'webgl'`) with a segmented toggle in the toolbar; renders
`<TraceGraph>` or `<TraceGraphGL>` over the same `graph`.

## Data flow

`useTracelight` (unchanged) → `graph` → both renderers. `TraceGraphGL` reads `graph.nodes`
/`graph.edges` for topology + counts, subscribes to `graph.onPulse` for dot spawns and flashes.
The Pixi scene is mutated imperatively from effects/refs; React does not re-render per frame.

## Out of scope (v1)
- Edge timing labels (min/avg/max) in GL.
- Node dragging in GL.
- WebGPU backend.
- Per-`traceId` continuous dot across the whole path.

## Success criteria
Both renderers show the same graph; under heavy traffic (e.g. 1000 rps) the WebGL FPS readout
stays high and dots stay smooth, giving a clear performance comparison against React Flow.
