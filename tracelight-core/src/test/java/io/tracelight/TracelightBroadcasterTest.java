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
