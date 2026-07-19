package io.beesofttech.tracelight;

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

    @Test
    void onEntryHitUpdatesEntryCountWithoutAnimationInImmediateMode() throws Exception {
        CollectingSink sink = new CollectingSink();
        GraphRegistry registry = new GraphRegistry();
        registry.ensureEntry("GET /order", "GET /order");
        TracelightBroadcaster broadcaster = new TracelightBroadcaster(registry, 0, sink);

        broadcaster.onEntryHit("GET /order", registry.recordEntryHit("GET /order"));
        sink.awaitFrames(1);

        JsonNode batch = mapper.readTree(sink.frames.get(0));
        assertThat(batch.get("type").asText()).isEqualTo("batch");
        assertThat(batch.get("edges")).isEmpty(); // no edge -> nothing animates
        JsonNode node = batch.get("nodes").get(0);
        assertThat(node.get("id").asText()).isEqualTo("GET /order");
        assertThat(node.get("count").asLong()).isEqualTo(1);
    }

    @Test
    void onEntryHitAccumulatesIntoBatchFlush() throws Exception {
        CollectingSink sink = new CollectingSink();
        GraphRegistry registry = new GraphRegistry();
        registry.ensureEntry("GET /order", "GET /order");
        TracelightBroadcaster broadcaster = new TracelightBroadcaster(registry, 30, sink);

        broadcaster.onEntryHit("GET /order", registry.recordEntryHit("GET /order"));
        sink.awaitFrames(1);

        JsonNode batch = mapper.readTree(sink.frames.get(0));
        assertThat(batch.get("type").asText()).isEqualTo("batch");
        assertThat(batch.get("edges")).isEmpty();
        JsonNode node = batch.get("nodes").get(0);
        assertThat(node.get("id").asText()).isEqualTo("GET /order");
        assertThat(node.get("count").asLong()).isEqualTo(1);
    }

    @Test
    void pulseCarriesRealPerHopLatency() throws Exception {
        CollectingSink sink = new CollectingSink();
        GraphRegistry registry = new GraphRegistry();
        TracelightBroadcaster broadcaster = new TracelightBroadcaster(registry, 0, sink);

        broadcaster.onHit(registry.recordHit("a", GraphRegistry.ENTRY_ID, 12_000_000L), "t1"); // 12 ms
        sink.awaitFrames(2); // topology (sync) + pulse

        JsonNode pulse = firstOfType(sink, "pulse");
        assertThat(pulse.get("ms").asDouble()).isEqualTo(12.0);
    }

    @Test
    void pulseOmitsMsWhenUntimed() throws Exception {
        CollectingSink sink = new CollectingSink();
        GraphRegistry registry = new GraphRegistry();
        TracelightBroadcaster broadcaster = new TracelightBroadcaster(registry, 0, sink);

        broadcaster.onHit(registry.recordHit("a", GraphRegistry.ENTRY_ID), "t1"); // no timing
        sink.awaitFrames(2);

        JsonNode pulse = firstOfType(sink, "pulse");
        assertThat(pulse.has("ms")).isFalse();
    }

    private JsonNode firstOfType(CollectingSink sink, String type) throws Exception {
        for (String f : java.util.List.copyOf(sink.frames)) {
            JsonNode n = mapper.readTree(f);
            if (type.equals(n.get("type").asText())) {
                return n;
            }
        }
        throw new AssertionError("no frame of type " + type);
    }

    private JsonNode firstEdgeOfSnapshot(TracelightBroadcaster broadcaster) throws Exception {
        JsonNode snapshot = mapper.readTree(broadcaster.snapshotJson());
        return snapshot.get("edges").get(0);
    }

    /** Collects broadcast frames; open/close/pulse arrive async on the pulse executor. */
    private static final class CollectingSink implements MessageSink {
        final java.util.List<String> frames = java.util.Collections.synchronizedList(new java.util.ArrayList<>());

        @Override
        public void broadcast(String json) {
            frames.add(json);
        }

        void awaitFrames(int n) throws InterruptedException {
            long deadline = System.currentTimeMillis() + 2000;
            while (frames.size() < n && System.currentTimeMillis() < deadline) {
                Thread.sleep(5);
            }
        }
    }

    @Test
    void openAndCloseAreEmittedInImmediateMode() throws Exception {
        CollectingSink sink = new CollectingSink();
        TracelightBroadcaster broadcaster = new TracelightBroadcaster(new GraphRegistry(), 0, sink);

        broadcaster.onTraceOpen("t1", "GET /order");
        broadcaster.onTraceClose("t1", "ship", "GET /order");
        sink.awaitFrames(2);

        JsonNode open = mapper.readTree(sink.frames.get(0));
        assertThat(open.get("type").asText()).isEqualTo("open");
        assertThat(open.get("traceId").asText()).isEqualTo("t1");
        assertThat(open.get("entry").asText()).isEqualTo("GET /order");

        JsonNode close = mapper.readTree(sink.frames.get(1));
        assertThat(close.get("type").asText()).isEqualTo("close");
        assertThat(close.get("traceId").asText()).isEqualTo("t1");
        assertThat(close.get("from").asText()).isEqualTo("ship");
        assertThat(close.get("to").asText()).isEqualTo("GET /order");
    }

    @Test
    void openAndCloseStayOrderedWithPulses() throws Exception {
        CollectingSink sink = new CollectingSink();
        GraphRegistry registry = new GraphRegistry();
        TracelightBroadcaster broadcaster = new TracelightBroadcaster(registry, 0, sink);

        broadcaster.onTraceOpen("t1", "GET /order");
        broadcaster.onHit(registry.recordHit("svc", "GET /order"), "t1");
        broadcaster.onTraceClose("t1", "svc", "GET /order");
        sink.awaitFrames(4); // topology (sync) + open + pulse + close

        var lifecycle = sink.frames.stream()
                .map(f -> {
                    try {
                        return mapper.readTree(f).get("type").asText();
                    } catch (Exception e) {
                        throw new RuntimeException(e);
                    }
                })
                .filter(t -> !"topology".equals(t))
                .toList();
        assertThat(lifecycle).containsExactly("open", "pulse", "close");
    }

    @Test
    void traceCompleteRecordsTerminalHopIntoReturnNode() throws Exception {
        CollectingSink sink = new CollectingSink();
        GraphRegistry registry = new GraphRegistry();
        registry.recordHit("svc", "GET /order");
        TracelightBroadcaster broadcaster = new TracelightBroadcaster(registry, 0, sink);

        broadcaster.onTraceComplete("t1", "svc", "GET /order", System.nanoTime());
        sink.awaitFrames(4); // topology(return node) + topology(return edge) + pulse + close

        GraphRegistry.NodeState ret = registry.node("Return GET /order");
        assertThat(ret).isNotNull();
        assertThat(ret.kind()).isEqualTo("entry"); // dark, styled like the start node
        assertThat(ret.count()).isEqualTo(1); // counts completed requests

        var types = new java.util.ArrayList<String>();
        JsonNode pulse = null;
        for (String f : java.util.List.copyOf(sink.frames)) {
            JsonNode n = mapper.readTree(f);
            types.add(n.get("type").asText());
            if ("pulse".equals(n.get("type").asText())) {
                pulse = n;
            }
        }
        assertThat(pulse).isNotNull();
        assertThat(pulse.get("from").asText()).isEqualTo("svc");
        assertThat(pulse.get("to").asText()).isEqualTo("Return GET /order");
        assertThat(types.get(types.size() - 1)).isEqualTo("close"); // close after the terminal hop
    }

    @Test
    void traceCompleteSkipsReturnNodeWhenNothingFired() throws Exception {
        CollectingSink sink = new CollectingSink();
        GraphRegistry registry = new GraphRegistry();
        TracelightBroadcaster broadcaster = new TracelightBroadcaster(registry, 0, sink);

        broadcaster.onTraceComplete("t1", "GET /ping", "GET /ping", System.nanoTime());
        sink.awaitFrames(1);

        assertThat(registry.node("Return GET /ping")).isNull();
        assertThat(mapper.readTree(sink.frames.get(0)).get("type").asText()).isEqualTo("close");
    }

    @Test
    void traceCompleteInBatchedModeAccumulatesButEmitsNoLifecycle() throws Exception {
        CollectingSink sink = new CollectingSink();
        GraphRegistry registry = new GraphRegistry();
        registry.recordHit("svc", "GET /order");
        TracelightBroadcaster broadcaster = new TracelightBroadcaster(registry, 60_000, sink);

        broadcaster.onTraceComplete("t1", "svc", "GET /order", System.nanoTime());
        sink.awaitFrames(2); // topology(return node) + topology(return edge) are still immediate
        Thread.sleep(50);

        // The return node/edge exist and the hit accumulated for the next batch window,
        // but no open/close/pulse frames were emitted.
        assertThat(registry.node("Return GET /order").count()).isEqualTo(1);
        for (String f : java.util.List.copyOf(sink.frames)) {
            assertThat(mapper.readTree(f).get("type").asText()).isEqualTo("topology");
        }
    }

    @Test
    void openAndCloseAreSuppressedInBatchedMode() throws Exception {
        CollectingSink sink = new CollectingSink();
        TracelightBroadcaster broadcaster = new TracelightBroadcaster(new GraphRegistry(), 60_000, sink);

        broadcaster.onTraceOpen("t1", "GET /order");
        broadcaster.onTraceClose("t1", "ship", "GET /order");
        Thread.sleep(50); // give a stray frame a chance to surface

        assertThat(sink.frames).isEmpty();
    }
}
