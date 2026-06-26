# tracelight-core extraction — design (step 1 of WebFlux support)

**Date:** 2026-06-26
**Status:** approved, pending implementation plan

## Context

WebFlux support is too large for one spec, so it is split into two steps:

1. **(this spec)** Extract `tracelight-core` — a transport-agnostic module — with **zero
   behaviour change** for the existing servlet/MVC adapter.
2. *(later, separate spec)* Add `tracelight-webflux`: a `WebFilter`, a reactive `@Around`
   aspect, a reactive WebSocket transport, and Reactor Context propagation.

This document covers step 1 only.

## Goal

Move all logic that does not depend on the servlet stack into a new `tracelight-core` module,
so the upcoming `tracelight-webflux` adapter can reuse it. The servlet adapter
(`tracelight-spring`) must behave **exactly as today** — same events, same endpoints, same
public API (`@TracePoint`, `Tracelight.hit/error`).

## Module layout

```
tracelight-core (new)
  depends on: spring-boot-autoconfigure, jackson  (NOT servlet/webflux/tomcat)
  GraphRegistry, TraceContext, TraceRecorder, DefaultTraceRecorder,
  Tracelight, TracePoint, TracelightProperties,
  TracelightBroadcaster (refactored), MessageSink (interface),
  TracelightCoreAutoConfiguration

tracelight-spring (existing → servlet/MVC adapter)
  depends on: tracelight-core, spring-boot-starter-websocket, spring-boot-starter-aop
  TraceFilter, TracePointAspect (@Before / @AfterThrowing — synchronous),
  TracelightWebSocketHandler, TracelightWebSocketConfig, TracelightController,
  ServletMessageSink, TracelightAutoConfiguration (servlet)
```

`tracelight-core` is **Spring-but-not-web**: it may use `@ConfigurationProperties`,
`@AutoConfiguration`, `@ConditionalOn…`, but must not reference any servlet or webflux type.

## TracelightBroadcaster split (the crux)

Today `TracelightBroadcaster` mixes event accumulation/serialization (transport-agnostic) with
sending over servlet `WebSocketSession` (transport-specific). Split along that seam:

- **Core keeps** all logic: per-window delta accumulation, the scheduled flush, and JSON
  serialization of every event (`snapshot`, `topology`, `pulse`, `batch`, `reset`). Sending is
  delegated to an injected sink:
  ```java
  public interface MessageSink {
      /** Broadcast one JSON frame to all connected clients. */
      void broadcast(String json);
  }
  ```
  - Constructor becomes `TracelightBroadcaster(GraphRegistry registry, long flushIntervalMs, MessageSink sink)`.
  - It no longer holds `Set<WebSocketSession>` and drops `register`/`remove`/`sendTo`.
  - `broadcast(json)` calls `sink.broadcast(json)`.
  - `snapshotJson()` becomes **public** so the adapter can send it to a newly connected client.
  - `onHit`, `onTopologyNode`, `reset`, `flush`, `close` stay in core, unchanged except for the
    delegation above.

- **Servlet adapter provides** `ServletMessageSink implements MessageSink`: holds the
  `Set<WebSocketSession>`, `broadcast(json)` iterates and `sendMessage`s (synchronized per
  session, dropping dead sessions — same logic as today's `broadcast`/`sendTo`).
  - `TracelightWebSocketHandler.afterConnectionEstablished`: `sink.add(session)` then
    `session.sendMessage(new TextMessage(broadcaster.snapshotJson()))`.
  - `afterConnectionClosed`: `sink.remove(session)`.
  - `handleTextMessage` (`"reset"`): `broadcaster.reset()` (unchanged).

  Snapshot-on-connect targets a single new client, so it is sent directly by the handler — not
  through `MessageSink.broadcast` (which fans out to everyone).

## Auto-configuration split

- **`TracelightCoreAutoConfiguration`** (`@ConditionalOnProperty tracelight.enabled`,
  `@EnableConfigurationProperties(TracelightProperties.class)`):
  - `GraphRegistry`
  - `TracelightBroadcaster` — `@ConditionalOnBean(MessageSink.class)`
  - `DefaultTraceRecorder` + `Tracelight.setRecorder(...)`
  - No aspect, filter, or WebSocket beans.

- **`TracelightAutoConfiguration`** (servlet, `@ConditionalOnWebApplication(SERVLET)`),
  imports the core auto-config:
  - `ServletMessageSink` (the `MessageSink` bean)
  - `TracelightWebSocketConfig` / handler
  - `TraceFilter` (FilterRegistrationBean, unchanged)
  - `TracePointAspect`
  - `TracelightController`

Bean wiring order: sink (adapter) → broadcaster (core, needs sink) → recorder (core, needs
broadcaster) → `Tracelight.setRecorder`.

## Aspect stays in the adapter

`TracePointAspect` (`@Before` + `@AfterThrowing`) assumes synchronous execution, so it stays in
`tracelight-spring`. The WebFlux adapter (step 2) will add its own `@Around` aspect that decorates
the returned `Mono`/`Flux`. The `TracePoint` annotation itself moves to `tracelight-core`.

## Build / wiring details

- New `tracelight-core/build.gradle`: `java-library`, dependency-management BOM 3.3.4,
  `api 'spring-boot-autoconfigure'`, Jackson (transitive via autoconfigure or explicit
  `com.fasterxml.jackson.core:jackson-databind`), configuration-processor, test deps.
- `tracelight-spring/build.gradle`: add `api project(':tracelight-core')`; keep
  starter-websocket + starter-aop.
- `settings.gradle`: `include 'tracelight-core'`.
- `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` in each
  module lists its own auto-configuration class.

## Testing / definition of done

- Move `GraphRegistryTest` to `tracelight-core`. Move/adapt the broadcaster test to use a
  `MessageSink` mock instead of a `WebSocketSession` mock; assert the same JSON.
- `:tracelight-spring:test` and `:tracelight-core:test` green.
- `:tracelight-demo-app:bootRun` works; the live UI behaves **identically** to today
  (snapshot on connect, pulses, batch, reset, error nodes) — quick Playwright sanity check.
- No change to the public API or to `tracelight.*` properties.

## Out of scope
- Anything reactive (Reactor Context, `@Around` aspect, reactive WebSocket) — that is step 2.
- Renaming `tracelight-spring` to `tracelight-spring-mvc` — reconsider in step 2 for symmetry
  with `tracelight-webflux`; not now, to keep this a pure refactor (demo-app dependency unchanged).
- Publishing artifacts.
