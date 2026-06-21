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
        TraceContext ctx = TraceContext.current();
        String from = (ctx != null) ? ctx.currentNodeId() : null;
        String traceId = (ctx != null) ? ctx.traceId() : "-";

        GraphRegistry.HitResult result = registry.recordHit(name, from);

        if (ctx != null) {
            ctx.currentNodeId(name);
        }
        broadcaster.onHit(result, traceId);
    }
}
