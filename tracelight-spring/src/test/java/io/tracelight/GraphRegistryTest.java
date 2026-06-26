package io.tracelight;

import org.junit.jupiter.api.Test;

import java.util.List;
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
    void recordErrorCreatesRedNodeWithMessageAndStack() {
        GraphRegistry registry = new GraphRegistry();

        registry.recordHit("payment", GraphRegistry.ENTRY_ID);
        registry.recordError("payment", "IllegalStateException", "boom", List.of("at A", "at B"));

        GraphRegistry.NodeState err = registry.node("payment!IllegalStateException");
        assertThat(err).isNotNull();
        assertThat(err.kind()).isEqualTo("error");
        assertThat(err.label()).isEqualTo("IllegalStateException");
        assertThat(err.message()).isEqualTo("boom");
        assertThat(err.stack()).containsExactly("at A", "at B");
        assertThat(err.count()).isEqualTo(1);
        assertThat(edgeIds(registry)).contains("payment->payment!IllegalStateException");
    }

    @Test
    void recordErrorIncrementsCounterAndKeepsFirstStack() {
        GraphRegistry registry = new GraphRegistry();

        registry.recordError("payment", "IllegalStateException", "first", List.of("at A"));
        registry.recordError("payment", "IllegalStateException", "second", List.of("at B"));

        GraphRegistry.NodeState err = registry.node("payment!IllegalStateException");
        assertThat(err.count()).isEqualTo(2);
        assertThat(err.message()).isEqualTo("first"); // first occurrence wins
    }

    @Test
    void resetClearsErrorCounters() {
        GraphRegistry registry = new GraphRegistry();
        registry.recordError("payment", "IllegalStateException", "boom", List.of("at A"));

        registry.resetCounters();

        assertThat(registry.node("payment!IllegalStateException").count()).isEqualTo(0);
    }

    @Test
    void recorderAttachesErrorToCurrentNode() {
        GraphRegistry registry = new GraphRegistry();
        DefaultTraceRecorder recorder = new DefaultTraceRecorder(registry, new TracelightBroadcaster(registry, 0));

        TraceContext.start(GraphRegistry.ENTRY_ID);
        try {
            recorder.hit("payment");
            recorder.error(new IllegalStateException("boom"));
        } finally {
            TraceContext.clear();
        }

        GraphRegistry.NodeState err = registry.node("payment!IllegalStateException");
        assertThat(err).isNotNull();
        assertThat(err.message()).isEqualTo("boom");
        assertThat(err.stack()).isNotEmpty();
        assertThat(edgeIds(registry)).contains("payment->payment!IllegalStateException");
    }

    @Test
    void recorderRecordsSameThrowableOnce() {
        GraphRegistry registry = new GraphRegistry();
        DefaultTraceRecorder recorder = new DefaultTraceRecorder(registry, new TracelightBroadcaster(registry, 0));

        TraceContext.start(GraphRegistry.ENTRY_ID);
        try {
            recorder.hit("payment");
            IllegalStateException ex = new IllegalStateException("boom");
            recorder.error(ex);
            recorder.error(ex); // same object unwinding through another @TracePoint
        } finally {
            TraceContext.clear();
        }

        assertThat(registry.node("payment!IllegalStateException").count()).isEqualTo(1);
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

    @Test
    void recorderTimesEdgesBetweenConsecutiveHits() throws InterruptedException {
        GraphRegistry registry = new GraphRegistry();
        DefaultTraceRecorder recorder = new DefaultTraceRecorder(registry, new TracelightBroadcaster(registry, 0));

        TraceContext.start(GraphRegistry.ENTRY_ID);
        try {
            recorder.hit("a");
            Thread.sleep(5);
            recorder.hit("b");
        } finally {
            TraceContext.clear();
        }

        assertThat(registry.edge("ENTRY->a").samples()).isEqualTo(1);
        GraphRegistry.EdgeState ab = registry.edge("a->b");
        assertThat(ab.samples()).isEqualTo(1);
        assertThat(ab.avgMs()).isGreaterThan(0.0);
    }

    @Test
    void edgeAggregatesMinAvgMaxTiming() {
        GraphRegistry registry = new GraphRegistry();

        registry.recordHit("a", GraphRegistry.ENTRY_ID, ms(10));
        registry.recordHit("a", GraphRegistry.ENTRY_ID, ms(30));
        registry.recordHit("a", GraphRegistry.ENTRY_ID, ms(20));

        GraphRegistry.EdgeState edge = registry.edge("ENTRY->a");
        assertThat(edge.samples()).isEqualTo(3);
        assertThat(edge.minMs()).isEqualTo(10.0);
        assertThat(edge.maxMs()).isEqualTo(30.0);
        assertThat(edge.avgMs()).isEqualTo(20.0);
    }

    @Test
    void negativeElapsedIsNotRecordedAsTiming() {
        GraphRegistry registry = new GraphRegistry();

        registry.recordHit("a", null, -1);

        GraphRegistry.EdgeState edge = registry.edge("ENTRY->a");
        assertThat(edge.samples()).isEqualTo(0);
        assertThat(edge.avgMs()).isEqualTo(0.0);
    }

    @Test
    void resetClearsEdgeTiming() {
        GraphRegistry registry = new GraphRegistry();

        registry.recordHit("a", null, ms(10));
        registry.resetCounters();

        GraphRegistry.EdgeState edge = registry.edge("ENTRY->a");
        assertThat(edge.samples()).isEqualTo(0);
        assertThat(edge.minMs()).isEqualTo(0.0);
        assertThat(edge.maxMs()).isEqualTo(0.0);
        assertThat(edge.avgMs()).isEqualTo(0.0);
    }

    /** The two-arg overload (no timing) leaves the edge without samples. */
    @Test
    void twoArgRecordHitRecordsNoTiming() {
        GraphRegistry registry = new GraphRegistry();

        registry.recordHit("a", null);

        assertThat(registry.edge("ENTRY->a").samples()).isEqualTo(0);
    }

    private static long ms(long millis) {
        return millis * 1_000_000L;
    }

    private static java.util.Set<String> edgeIds(GraphRegistry registry) {
        return registry.edges().stream().map(GraphRegistry.EdgeState::id).collect(Collectors.toSet());
    }

    private static Map<String, Long> counts(GraphRegistry registry) {
        return registry.nodes().stream()
                .collect(Collectors.toMap(GraphRegistry.NodeState::id, GraphRegistry.NodeState::count));
    }
}
