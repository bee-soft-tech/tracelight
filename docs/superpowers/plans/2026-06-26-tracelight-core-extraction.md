# tracelight-core Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a transport-agnostic `tracelight-core` Gradle module out of `tracelight-spring`, with zero behaviour change for the existing servlet adapter, so a future `tracelight-webflux` adapter can reuse it.

**Architecture:** Move all non-web logic (graph registry, trace context, recorder, static API, event accumulation + JSON serialization, properties) into `tracelight-core`. The servlet `TracelightBroadcaster` is split along its one transport seam: serialization stays in core and delegates sending to a new `MessageSink` interface, which the servlet adapter implements as `ServletMessageSink`. Auto-configuration splits into a core config (registry/broadcaster/recorder) and a servlet config (sink/WebSocket/filter/aspect/controller).

**Tech Stack:** Java 17, Spring Boot 3.3.4, Gradle (wrapper 8.7), JUnit 5, AssertJ, Jackson.

## Global Constraints

- Java toolchain **17** (root `build.gradle` sets this for all subprojects).
- Spring Boot BOM **3.3.4** (`io.spring.dependency-management`).
- Build only with the wrapper: `./gradlew` (system Gradle 4.4.1 is too old).
- All classes stay in package **`io.tracelight`** (split across core + adapter on the classpath is intentional — keeps consumer imports and internal references unchanged; the library has no `module-info.java`, so split packages are fine).
- `tracelight-core` must **not** reference any servlet, webflux, or tomcat type.
- **Zero behaviour change**: same WebSocket events, same `tracelight.*` properties, same public API (`@TracePoint`, `Tracelight.hit/error`). This is a pure refactor guarded by the existing tests.
- Commit after each task.

## File Structure

**New module `tracelight-core`:**
- `tracelight-core/build.gradle` — module build (autoconfigure + jackson, no web).
- `tracelight-core/src/main/resources/META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` — lists `io.tracelight.TracelightCoreAutoConfiguration`.
- Moved into `tracelight-core/src/main/java/io/tracelight/`: `GraphRegistry`, `TraceContext`, `TraceRecorder`, `DefaultTraceRecorder`, `Tracelight`, `TracePoint`, `TracelightProperties`, `TracelightBroadcaster`.
- New in core: `MessageSink` (interface), `TracelightCoreAutoConfiguration`.
- Moved tests into `tracelight-core/src/test/java/io/tracelight/`: `GraphRegistryTest`, `TracelightBroadcasterTest`.

**Existing module `tracelight-spring` (servlet adapter), after extraction:**
- Keeps: `TraceFilter`, `TracePointAspect`, `TracelightWebSocketHandler`, `TracelightWebSocketConfig`, `TracelightController`, `TracelightAutoConfiguration`.
- New: `ServletMessageSink`.
- `tracelight-spring/build.gradle` — adds `api project(':tracelight-core')`.

**Root:**
- `settings.gradle` — add `include 'tracelight-core'`.

---

### Task 1: Scaffold the `tracelight-core` module

**Files:**
- Create: `tracelight-core/build.gradle`
- Modify: `settings.gradle`

**Interfaces:**
- Consumes: nothing.
- Produces: an empty, buildable `:tracelight-core` module other tasks add code to.

- [ ] **Step 1: Add the module to the build**

Modify `settings.gradle` to:

```groovy
rootProject.name = 'tracelight'

include 'tracelight-core'
include 'tracelight-spring'
include 'tracelight-demo-app'
```

- [ ] **Step 2: Create `tracelight-core/build.gradle`**

```groovy
plugins {
    id 'java-library'
    id 'io.spring.dependency-management'
}

dependencyManagement {
    imports {
        mavenBom "org.springframework.boot:spring-boot-dependencies:3.3.4"
    }
}

dependencies {
    // Spring-but-not-web: config properties + auto-configuration, plus JSON. No servlet/webflux.
    api 'org.springframework.boot:spring-boot-autoconfigure'
    api 'com.fasterxml.jackson.core:jackson-databind'

    annotationProcessor 'org.springframework.boot:spring-boot-configuration-processor'

    testImplementation 'org.springframework.boot:spring-boot-starter-test'
}
```

- [ ] **Step 3: Verify the empty module builds**

Run: `./gradlew :tracelight-core:build`
Expected: `BUILD SUCCESSFUL` (no sources yet).

- [ ] **Step 4: Commit**

```bash
git add settings.gradle tracelight-core/build.gradle
git commit -m "build: scaffold tracelight-core module"
```

---

### Task 2: Move transport-agnostic leaf classes to core

Move the classes that do **not** depend on the broadcaster. `DefaultTraceRecorder` and `TracelightBroadcaster` stay in `tracelight-spring` for now (Task 3 moves them once the sink seam exists).

**Files:**
- Move (git mv, path only — content unchanged): `GraphRegistry.java`, `TraceContext.java`, `TraceRecorder.java`, `Tracelight.java`, `TracePoint.java`, `TracelightProperties.java` from `tracelight-spring/src/main/java/io/tracelight/` to `tracelight-core/src/main/java/io/tracelight/`.
- Move: `tracelight-spring/src/test/java/io/tracelight/GraphRegistryTest.java` → `tracelight-core/src/test/java/io/tracelight/GraphRegistryTest.java`.
- Modify: `tracelight-spring/build.gradle`.

**Interfaces:**
- Consumes: `:tracelight-core` module (Task 1).
- Produces (now in core, signatures unchanged): `GraphRegistry`, `GraphRegistry.NodeState`, `GraphRegistry.EdgeState`, `GraphRegistry.HitResult`; `TraceContext` (`start`, `current`, `clear`, `currentNodeId`, `lastHitNanos`, `markErrorIfNew`); `interface TraceRecorder { void hit(String); void error(Throwable); }`; `Tracelight` (`setRecorder`, `hit`, `error`); `@TracePoint`; `TracelightProperties`.

- [ ] **Step 1: Move the six classes and the registry test**

```bash
cd /home/bozo/claude-projects/tracelight
mkdir -p tracelight-core/src/main/java/io/tracelight tracelight-core/src/test/java/io/tracelight
git mv tracelight-spring/src/main/java/io/tracelight/GraphRegistry.java tracelight-core/src/main/java/io/tracelight/
git mv tracelight-spring/src/main/java/io/tracelight/TraceContext.java tracelight-core/src/main/java/io/tracelight/
git mv tracelight-spring/src/main/java/io/tracelight/TraceRecorder.java tracelight-core/src/main/java/io/tracelight/
git mv tracelight-spring/src/main/java/io/tracelight/Tracelight.java tracelight-core/src/main/java/io/tracelight/
git mv tracelight-spring/src/main/java/io/tracelight/TracePoint.java tracelight-core/src/main/java/io/tracelight/
git mv tracelight-spring/src/main/java/io/tracelight/TracelightProperties.java tracelight-core/src/main/java/io/tracelight/
git mv tracelight-spring/src/test/java/io/tracelight/GraphRegistryTest.java tracelight-core/src/test/java/io/tracelight/
```

The package declaration stays `io.tracelight` in every file — no content edits needed.

- [ ] **Step 2: Make `tracelight-spring` depend on core**

Modify `tracelight-spring/build.gradle` dependencies block to add the project dependency at the top:

```groovy
dependencies {
    api project(':tracelight-core')

    // Brings spring-web, spring-websocket and the embedded tomcat websocket runtime,
    // so any app that adds this library gets a working /tracelight/ws endpoint.
    api 'org.springframework.boot:spring-boot-starter-websocket'
    api 'org.springframework.boot:spring-boot-starter-aop'
    api 'org.springframework.boot:spring-boot-autoconfigure'

    annotationProcessor 'org.springframework.boot:spring-boot-configuration-processor'

    testImplementation 'org.springframework.boot:spring-boot-starter-test'
}
```

- [ ] **Step 3: Build both modules and run the moved test**

Run: `./gradlew :tracelight-core:test :tracelight-spring:build`
Expected: `BUILD SUCCESSFUL`. `GraphRegistryTest` runs under `:tracelight-core` and passes; `DefaultTraceRecorder`/`TracelightBroadcaster` in `tracelight-spring` still compile against the moved classes (same package, now via the core dependency).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: move transport-agnostic classes to tracelight-core"
```

---

### Task 3: Split the broadcaster behind `MessageSink` and move it to core

Introduce the one transport seam, move `TracelightBroadcaster` + `DefaultTraceRecorder` into core, and provide `ServletMessageSink` + an updated WebSocket handler in the adapter — all in one task so the build is never broken mid-way.

**Files:**
- Create: `tracelight-core/src/main/java/io/tracelight/MessageSink.java`
- Move + modify: `TracelightBroadcaster.java`, `DefaultTraceRecorder.java` → `tracelight-core/...`
- Move + modify: `tracelight-spring/.../TracelightBroadcasterTest.java` → `tracelight-core/...`
- Create: `tracelight-spring/src/main/java/io/tracelight/ServletMessageSink.java`
- Modify: `tracelight-spring/.../TracelightWebSocketHandler.java`

**Interfaces:**
- Consumes: `GraphRegistry`, `TraceContext`, `TraceRecorder`, `Tracelight` (Task 2).
- Produces:
  - `interface MessageSink { void broadcast(String json); }` (core)
  - `TracelightBroadcaster(GraphRegistry registry, long flushIntervalMs, MessageSink sink)` with **public** `String snapshotJson()`, and existing `onHit(HitResult, String)`, `onTopologyNode(NodeState)`, `reset()`, `close()`. No `register`/`remove`/`sendTo`.
  - `ServletMessageSink implements MessageSink` with `void add(WebSocketSession)`, `void remove(WebSocketSession)`, `void broadcast(String)` (adapter).

- [ ] **Step 1: Create `MessageSink` in core**

`tracelight-core/src/main/java/io/tracelight/MessageSink.java`:

```java
package io.tracelight;

/** Transport abstraction: send one JSON frame to all currently connected UI clients. */
public interface MessageSink {
    void broadcast(String json);
}
```

- [ ] **Step 2: Move and refactor `TracelightBroadcaster` into core**

```bash
git mv tracelight-spring/src/main/java/io/tracelight/TracelightBroadcaster.java tracelight-core/src/main/java/io/tracelight/
git mv tracelight-spring/src/main/java/io/tracelight/DefaultTraceRecorder.java tracelight-core/src/main/java/io/tracelight/
git mv tracelight-spring/src/test/java/io/tracelight/TracelightBroadcasterTest.java tracelight-core/src/test/java/io/tracelight/
```

In `tracelight-core/.../TracelightBroadcaster.java`:
- Remove the servlet imports (`org.springframework.web.socket.TextMessage`, `WebSocketSession`) and the `java.io.IOException` import if now unused.
- Replace the session field and constructor. Change:

```java
    private final Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet();
```
to:
```java
    private final MessageSink sink;
```

- Change the constructor signature and body header from:
```java
    public TracelightBroadcaster(GraphRegistry registry, long flushIntervalMs) {
        this.registry = registry;
        this.flushIntervalMs = flushIntervalMs;
```
to:
```java
    public TracelightBroadcaster(GraphRegistry registry, long flushIntervalMs, MessageSink sink) {
        this.registry = registry;
        this.flushIntervalMs = flushIntervalMs;
        this.sink = sink;
```

- Delete the `register(WebSocketSession)` and `remove(WebSocketSession)` methods entirely.
- Make `snapshotJson()` public: change `private String snapshotJson()` to `public String snapshotJson()`.
- Replace the `broadcast` method and delete `sendTo`. Change:
```java
    private void broadcast(String json) {
        for (WebSocketSession session : sessions) {
            sendTo(session, json);
        }
    }

    private void sendTo(WebSocketSession session, String json) {
        if (!session.isOpen()) {
            sessions.remove(session);
            return;
        }
        try {
            // WebSocketSession is not safe for concurrent sends.
            synchronized (session) {
                session.sendMessage(new TextMessage(json));
            }
        } catch (IOException | IllegalStateException ex) {
            sessions.remove(session);
        }
    }
```
to:
```java
    private void broadcast(String json) {
        sink.broadcast(json);
    }
```

Everything else (delta accumulation, `flush`, `onHit`, `onTopologyNode`, `reset`, `close`, all `*Json` builders) is unchanged.

- [ ] **Step 3: Adapt the broadcaster test to core (no servlet mock)**

Replace `tracelight-core/src/test/java/io/tracelight/TracelightBroadcasterTest.java` with a version that calls the now-public `snapshotJson()` directly and passes a no-op `MessageSink`:

```java
package io.tracelight;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class TracelightBroadcasterTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private static final MessageSink NOOP = json -> { };

    @Test
    void snapshotIncludesEdgeTimingWhenSampled() throws Exception {
        GraphRegistry registry = new GraphRegistry();
        registry.recordHit("a", GraphRegistry.ENTRY_ID, 10_000_000L); // 10 ms
        TracelightBroadcaster broadcaster = new TracelightBroadcaster(registry, 0, NOOP);

        JsonNode edge = firstEdgeOfSnapshot(broadcaster);

        assertThat(edge.get("samples").asLong()).isEqualTo(1);
        assertThat(edge.get("min").asDouble()).isEqualTo(10.0);
        assertThat(edge.get("avg").asDouble()).isEqualTo(10.0);
        assertThat(edge.get("max").asDouble()).isEqualTo(10.0);
    }

    @Test
    void snapshotOmitsTimingWhenNoSamples() throws Exception {
        GraphRegistry registry = new GraphRegistry();
        registry.recordHit("a", GraphRegistry.ENTRY_ID); // no timing
        TracelightBroadcaster broadcaster = new TracelightBroadcaster(registry, 0, NOOP);

        JsonNode edge = firstEdgeOfSnapshot(broadcaster);

        assertThat(edge.has("min")).isFalse();
        assertThat(edge.has("avg")).isFalse();
        assertThat(edge.has("samples")).isFalse();
    }

    @Test
    void snapshotIncludesMessageAndStackForErrorNodes() throws Exception {
        GraphRegistry registry = new GraphRegistry();
        registry.recordError("payment", "IllegalStateException", "boom", java.util.List.of("at A", "at B"));
        TracelightBroadcaster broadcaster = new TracelightBroadcaster(registry, 0, NOOP);

        JsonNode snapshot = mapper.readTree(broadcaster.snapshotJson());
        JsonNode errorNode = null;
        for (JsonNode n : snapshot.get("nodes")) {
            if ("error".equals(n.path("kind").asText())) {
                errorNode = n;
            }
        }
        assertThat(errorNode).isNotNull();
        assertThat(errorNode.get("message").asText()).isEqualTo("boom");
        assertThat(errorNode.get("stack").get(0).asText()).isEqualTo("at A");
    }

    private JsonNode firstEdgeOfSnapshot(TracelightBroadcaster broadcaster) throws Exception {
        JsonNode snapshot = mapper.readTree(broadcaster.snapshotJson());
        return snapshot.get("edges").get(0);
    }
}
```

- [ ] **Step 4: Create `ServletMessageSink` in the adapter**

`tracelight-spring/src/main/java/io/tracelight/ServletMessageSink.java`:

```java
package io.tracelight;

import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** Servlet WebSocket implementation of {@link MessageSink}: fans a JSON frame out to all sessions. */
public class ServletMessageSink implements MessageSink {

    private final Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet();

    public void add(WebSocketSession session) {
        sessions.add(session);
    }

    public void remove(WebSocketSession session) {
        sessions.remove(session);
    }

    @Override
    public void broadcast(String json) {
        for (WebSocketSession session : sessions) {
            send(session, json);
        }
    }

    private void send(WebSocketSession session, String json) {
        if (!session.isOpen()) {
            sessions.remove(session);
            return;
        }
        try {
            // WebSocketSession is not safe for concurrent sends.
            synchronized (session) {
                session.sendMessage(new TextMessage(json));
            }
        } catch (IOException | IllegalStateException ex) {
            sessions.remove(session);
        }
    }
}
```

- [ ] **Step 5: Update the WebSocket handler to use the sink + send snapshot on connect**

Replace `tracelight-spring/src/main/java/io/tracelight/TracelightWebSocketHandler.java` with:

```java
package io.tracelight;

import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;

/**
 * WebSocket endpoint handler. On connect the client is registered with the {@link ServletMessageSink}
 * and receives a full snapshot; afterwards it receives live events broadcast through the sink.
 * A client may send {@code "reset"} to zero the counters.
 */
public class TracelightWebSocketHandler extends TextWebSocketHandler {

    private final TracelightBroadcaster broadcaster;
    private final ServletMessageSink sink;

    public TracelightWebSocketHandler(TracelightBroadcaster broadcaster, ServletMessageSink sink) {
        this.broadcaster = broadcaster;
        this.sink = sink;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws IOException {
        sink.add(session);
        session.sendMessage(new TextMessage(broadcaster.snapshotJson()));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sink.remove(session);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        String payload = message.getPayload();
        if (payload != null && payload.contains("reset")) {
            broadcaster.reset();
        }
    }
}
```

- [ ] **Step 6: Update `TracelightWebSocketConfig` to pass the sink to the handler**

In `tracelight-spring/src/main/java/io/tracelight/TracelightWebSocketConfig.java`, change the constructor to accept the sink and build the handler with it:

```java
    public TracelightWebSocketConfig(
            TracelightProperties properties, TracelightBroadcaster broadcaster, ServletMessageSink sink) {
        this.properties = properties;
        this.handler = new TracelightWebSocketHandler(broadcaster, sink);
    }
```

(The rest of the class is unchanged.)

- [ ] **Step 7: Build and run all backend tests**

Run: `./gradlew :tracelight-core:test :tracelight-spring:build`
Expected: `BUILD SUCCESSFUL`. The core broadcaster test passes; `tracelight-spring` compiles (`TracelightWebSocketConfig` now needs a `ServletMessageSink` bean — wired in Task 4; it compiles here because the constructor just takes the type).

Note: `:tracelight-spring:build` compiles but the app is not wired end-to-end until Task 4 provides the `ServletMessageSink` and `MessageSink` beans. Do not run the demo app until Task 4.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: split broadcaster behind MessageSink, move to core"
```

---

### Task 4: Split auto-configuration into core + servlet

**Files:**
- Create: `tracelight-core/src/main/java/io/tracelight/TracelightCoreAutoConfiguration.java`
- Create: `tracelight-core/src/main/resources/META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`
- Modify: `tracelight-spring/src/main/java/io/tracelight/TracelightAutoConfiguration.java`
- Modify: `tracelight-spring/.../TracelightController.java` (no change to logic; verify it compiles against core broadcaster — it does, same package).

**Interfaces:**
- Consumes: `GraphRegistry`, `TracelightBroadcaster(registry, flushIntervalMs, sink)`, `DefaultTraceRecorder`, `Tracelight`, `MessageSink`, `ServletMessageSink`, `TracelightProperties`, `TraceFilter`, `TracePointAspect`, `TracelightController`, `TracelightWebSocketConfig`.
- Produces: two auto-configurations that together wire exactly the beans the single `TracelightAutoConfiguration` wired before.

- [ ] **Step 1: Create the core auto-configuration**

`tracelight-core/src/main/java/io/tracelight/TracelightCoreAutoConfiguration.java`:

```java
package io.tracelight;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

/**
 * Transport-agnostic Tracelight wiring: the graph registry, the broadcaster (which needs a
 * {@link MessageSink} supplied by a transport adapter), and the recorder. A servlet or webflux
 * adapter contributes the {@link MessageSink} and the request/WebSocket plumbing.
 */
@AutoConfiguration
@ConditionalOnProperty(prefix = "tracelight", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(TracelightProperties.class)
public class TracelightCoreAutoConfiguration {

    @Bean
    public GraphRegistry tracelightGraphRegistry() {
        return new GraphRegistry();
    }

    @Bean
    @ConditionalOnBean(MessageSink.class)
    public TracelightBroadcaster tracelightBroadcaster(
            GraphRegistry registry, TracelightProperties properties, MessageSink sink) {
        return new TracelightBroadcaster(registry, properties.getFlushIntervalMs(), sink);
    }

    @Bean
    @ConditionalOnBean(TracelightBroadcaster.class)
    public TraceRecorder tracelightRecorder(GraphRegistry registry, TracelightBroadcaster broadcaster) {
        DefaultTraceRecorder recorder = new DefaultTraceRecorder(registry, broadcaster);
        Tracelight.setRecorder(recorder);
        return recorder;
    }
}
```

- [ ] **Step 2: Register the core auto-configuration**

Create `tracelight-core/src/main/resources/META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` with one line:

```
io.tracelight.TracelightCoreAutoConfiguration
```

- [ ] **Step 3: Slim the servlet auto-configuration**

Replace `tracelight-spring/src/main/java/io/tracelight/TracelightAutoConfiguration.java` with a version that contributes only the servlet beans and the `MessageSink`, importing nothing it no longer owns:

```java
package io.tracelight;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.core.Ordered;

/**
 * Servlet adapter wiring: contributes the {@link ServletMessageSink} consumed by the core
 * broadcaster, the WebSocket endpoint, the request filter, the AOP aspect, and the reset
 * controller. The transport-agnostic beans come from {@link TracelightCoreAutoConfiguration}.
 */
@AutoConfiguration(after = TracelightCoreAutoConfiguration.class)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(prefix = "tracelight", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(TracelightProperties.class)
@Import(TracelightWebSocketConfig.class)
public class TracelightAutoConfiguration {

    @Bean
    public ServletMessageSink tracelightMessageSink() {
        return new ServletMessageSink();
    }

    @Bean
    public TracePointAspect tracelightTracePointAspect(TraceRecorder recorder) {
        return new TracePointAspect(recorder);
    }

    @Bean
    public FilterRegistrationBean<TraceFilter> tracelightTraceFilter(
            GraphRegistry registry, TracelightBroadcaster broadcaster, TracelightProperties properties) {
        FilterRegistrationBean<TraceFilter> registration =
                new FilterRegistrationBean<>(new TraceFilter(registry, broadcaster, properties.getBasePath()));
        registration.addUrlPatterns("/*");
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE + 10);
        return registration;
    }

    @Bean
    public TracelightController tracelightController(TracelightBroadcaster broadcaster) {
        return new TracelightController(broadcaster);
    }
}
```

The `TracelightWebSocketConfig` (imported) consumes `ServletMessageSink` + `TracelightBroadcaster` beans; the filter and controller consume the core `TracelightBroadcaster`. `@AutoConfiguration(after = ...)` guarantees the sink and broadcaster exist first.

- [ ] **Step 4: Build everything and run the demo app**

Run: `./gradlew build`
Expected: `BUILD SUCCESSFUL`; all module tests pass.

Then start the demo to confirm wiring:
Run: `./gradlew :tracelight-demo-app:bootRun` (in the background), then `curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8080/order -H 'Content-Type: application/json' -d '{"amount":120,"premium":true,"country":"US"}'`
Expected: `200`. Stop the app afterwards.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: split auto-configuration into core + servlet adapter"
```

---

### Task 5: End-to-end verification (zero behaviour change)

**Files:** none (verification only).

**Interfaces:**
- Consumes: the fully wired demo app from Task 4.
- Produces: confidence that the live UI behaves identically to before the refactor.

- [ ] **Step 1: Full clean build + tests**

Run: `./gradlew clean build`
Expected: `BUILD SUCCESSFUL`; `:tracelight-core:test` runs `GraphRegistryTest` + `TracelightBroadcasterTest`, `:tracelight-spring` compiles, all green.

- [ ] **Step 2: Start the stack**

```bash
./gradlew :tracelight-demo-app:bootRun   # backend :8080 (background)
npm run dev -w tracelight-web            # frontend :5173 (background)
cd tracelight-load && .venv/bin/python -m tracelight_load --url http://localhost:8080 --rps 30 --scenario order
```

- [ ] **Step 3: Sanity-check the live UI**

Open http://localhost:5173. Confirm, matching pre-refactor behaviour:
- Nodes appear and pulse; counters increment.
- Edge `min / avg / max` timing labels show.
- A red `IllegalStateException` node appears under load (amounts > 1900) and its stack panel opens on click.
- "Reset counters" zeroes counters and the error node disappears.
- Both React Flow and WebGL renderers work.

Expected: identical to behaviour before this plan. If anything differs, the refactor changed behaviour — stop and investigate (use systematic-debugging).

- [ ] **Step 4: Stop the stack and commit any notes**

Stop bootRun, the dev server, and the load generator. No code change expected; if a doc note is warranted, commit it:

```bash
git commit --allow-empty -m "test: verify tracelight-core extraction is behaviour-preserving"
```

---

## Self-Review

**Spec coverage:**
- Module layout (core + servlet, core deps) → Tasks 1, 2.
- All transport-agnostic classes moved → Tasks 2, 3.
- `MessageSink` seam + broadcaster split + public `snapshotJson()` → Task 3.
- `ServletMessageSink` + snapshot-on-connect in handler → Task 3.
- Auto-config split (core `@ConditionalOnBean(MessageSink)`, servlet `@ConditionalOnWebApplication(SERVLET)`, `imports` files) → Task 4.
- Aspect stays in adapter; `TracePoint` annotation in core → Task 2 (annotation), Task 4 (aspect bean stays in servlet config).
- Tests moved/adapted (`MessageSink` mock → no-op) → Tasks 2, 3.
- Zero behaviour change verified (demo + UI) → Tasks 4, 5.
- `tracelight.*` properties unchanged → `TracelightProperties` moved verbatim (Task 2), `@EnableConfigurationProperties` in both configs (Task 4).

**Placeholder scan:** none — every code change shows full content; commands have expected output.

**Type consistency:** `TracelightBroadcaster(GraphRegistry, long, MessageSink)` used identically in Task 3 (definition), Task 4 (core config). `ServletMessageSink` `add`/`remove`/`broadcast` used in Task 3 (handler) and instantiated in Task 4. `TracelightWebSocketHandler(broadcaster, sink)` matches between Task 3 (Step 5) and `TracelightWebSocketConfig` (Step 6). `snapshotJson()` made public in Task 3, called by handler (Task 3) and tests (Task 3).
