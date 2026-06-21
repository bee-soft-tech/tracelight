# Tracelight

**See where a request is in your code — live.**

Tracelight is a real-time request-flow visualizer. Unlike Zipkin/Jaeger (which collect
traces historically), Tracelight shows the **current** position of requests on a graph of
your code: you drop **points** in your code, and on the frontend a node **pulses** and its
**counter increments** the moment a request passes through it. No history — just the live picture.

```
@TracePoint("validate")          Tracelight.hit("branch-premium")
        │                                  │
        ▼                                  ▼
  ┌──────────┐   pulse + counter    ┌──────────┐
  │ validate │ ───────────────────▶ │ premium  │   ← node blinks, dot flies along the edge
  └──────────┘                      └──────────┘
```

## Modules

| Module | What it is |
|---|---|
| [`tracelight-spring`](tracelight-spring/) | Java/Spring Boot 3 library — the core. Annotation `@TracePoint`, `Tracelight.hit()`, ThreadLocal context, in-memory graph, auto-configured WebSocket endpoint `/tracelight/ws`. |
| [`tracelight-react`](tracelight-react/) | `@tracelight/react` — headless `<TraceGraph>` (React Flow + elkjs) + `useTracelight()` hook. Blink, counter, flying dot. |
| [`tracelight-web`](tracelight-web/) | Demo site mounting `<TraceGraph>`. |
| [`tracelight-demo-app`](tracelight-demo-app/) | Spring Boot demo service with branching endpoints, instrumented. |
| [`tracelight-load`](tracelight-load/) | Python (httpx + asyncio) load generator. |

## How it works

1. You mark points in code: `@TracePoint("name")` on a method, or `Tracelight.hit("name")` anywhere (e.g. inside an `if`).
2. A servlet filter opens a `ThreadLocal` trace context per request. Each `hit` records an edge `previous-point → current-point`, so the **graph discovers itself** from real traffic.
3. The library broadcasts lightweight JSON events over a WebSocket (`/tracelight/ws`).
4. `<TraceGraph>` lays the graph out left→right with elkjs and animates pulses in real time.

## Quick start

```bash
# 1. Backend (downloads Gradle 8.7 via wrapper on first run)
./gradlew :tracelight-demo-app:bootRun

# 2. Frontend
npm install
npm run dev -w tracelight-web

# 3. Generate traffic
cd tracelight-load && python -m tracelight_load --url http://localhost:8080 --rps 20
```

Open the web app and watch the graph light up.

## Requirements

- Java 17+ (Gradle 8.7 is fetched automatically by the wrapper)
- Node 18+ / npm
- Python 3.9+

## License

MIT
