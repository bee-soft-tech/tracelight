package io.tracelight;

/**
 * Default recorder: reads the {@link TraceContext}, records the hit in the
 * {@link GraphRegistry}, advances the context's current node, and pushes the
 * resulting events through the {@link TracelightBroadcaster}.
 */
public class DefaultTraceRecorder implements TraceRecorder {

    private final GraphRegistry registry;
    private final TracelightBroadcaster broadcaster;

    public DefaultTraceRecorder(GraphRegistry registry, TracelightBroadcaster broadcaster) {
        this.registry = registry;
        this.broadcaster = broadcaster;
    }

    @Override
    public void hit(String name) {
        if (name == null || name.isEmpty()) {
            return;
        }
        var ctx = TraceContext.current();
        var from = (ctx != null) ? ctx.currentNodeId() : null;
        var traceId = (ctx != null) ? ctx.traceId() : "-";

        long now = System.nanoTime();
        long elapsedNanos = (ctx != null) ? now - ctx.lastHitNanos() : -1;

        var result = registry.recordHit(name, from, elapsedNanos);

        if (ctx != null) {
            ctx.currentNodeId(name);
            ctx.lastHitNanos(now);
        }
        broadcaster.onHit(result, traceId);
    }
}
