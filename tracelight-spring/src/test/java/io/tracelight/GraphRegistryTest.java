package io.tracelight;

import org.junit.jupiter.api.Test;

import java.util.stream.Collectors;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class GraphRegistryTest {

    @Test
    void firstHitCreatesNodeAndEdgeFromEntry() {
        GraphRegistry registry = new GraphRegistry();

        GraphRegistry.HitResult result = registry.recordHit("validate", null);

        assertThat(result.from).isEqualTo(GraphRegistry.ENTRY_ID);
        assertThat(result.to).isEqualTo("validate");
        assertThat(result.count).isEqualTo(1);
        assertThat(result.newEdge).isNotNull();
        assertThat(edgeIds(registry)).contains("ENTRY->validate");
    }

    @Test
    void edgeFollowsThePreviousNode() {
        GraphRegistry registry = new GraphRegistry();

        registry.recordHit("a", GraphRegistry.ENTRY_ID);
        registry.recordHit("b", "a");

        assertThat(edgeIds(registry)).contains("ENTRY->a", "a->b");
    }

    @Test
    void countersIncrementPerNodeAndResetClearsThem() {
        GraphRegistry registry = new GraphRegistry();

        registry.recordHit("a", null);
        registry.recordHit("a", null);
        assertThat(counts(registry).get("a")).isEqualTo(2L);

        registry.resetCounters();
        assertThat(counts(registry).get("a")).isEqualTo(0L);
    }

    @Test
    void recorderTracksThreadLocalSequence() {
        GraphRegistry registry = new GraphRegistry();
        DefaultTraceRecorder recorder = new DefaultTraceRecorder(registry, new TracelightBroadcaster(registry, 0));

        TraceContext.start(GraphRegistry.ENTRY_ID);
        try {
            recorder.hit("a");
            recorder.hit("b");
        } finally {
            TraceContext.clear();
        }

        assertThat(edgeIds(registry)).contains("ENTRY->a", "a->b");
        assertThat(counts(registry)).containsEntry("a", 1L).containsEntry("b", 1L);
    }

    private static java.util.Set<String> edgeIds(GraphRegistry registry) {
        return registry.edges().stream().map(GraphRegistry.EdgeState::id).collect(Collectors.toSet());
    }

    private static Map<String, Long> counts(GraphRegistry registry) {
        return registry.nodes().stream()
                .collect(Collectors.toMap(GraphRegistry.NodeState::id, GraphRegistry.NodeState::count));
    }
}
