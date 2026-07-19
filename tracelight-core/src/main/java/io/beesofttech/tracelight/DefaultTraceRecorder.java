package io.beesofttech.tracelight;

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

    /** Number of stack frames captured per error node. */
    private static final int MAX_FRAMES = 10;

    @Override
    public void error(Throwable t) {
        if (t == null) {
            return;
        }
        var ctx = TraceContext.current();
        // Dedup: the same throwable unwinding through nested @TracePoint methods is recorded once.
        if (ctx != null && !ctx.markErrorIfNew(t)) {
            return;
        }
        var from = (ctx != null) ? ctx.currentNodeId() : GraphRegistry.ENTRY_ID;
        var traceId = (ctx != null) ? ctx.traceId() : "-";

        var simpleName = t.getClass().getSimpleName();
        var stack = new java.util.ArrayList<String>(MAX_FRAMES);
        var frames = t.getStackTrace();
        for (int i = 0; i < frames.length && i < MAX_FRAMES; i++) {
            stack.add(frames[i].toString());
        }

        var result = registry.recordError(from, simpleName, t.getMessage(), stack);
        // An error is a leaf — leave currentNodeId untouched so the request can keep unwinding.
        broadcaster.onHit(result, traceId);
    }
}
