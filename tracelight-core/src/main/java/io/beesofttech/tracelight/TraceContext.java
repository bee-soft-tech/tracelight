package io.beesofttech.tracelight;

import java.util.UUID;

/**
 * Per-request trace state held in a {@link ThreadLocal}.
 *
 * <p>Holds the request's {@code traceId} and the id of the last point hit
 * ({@code currentNodeId}). The next {@link Tracelight#hit(String)} uses
 * {@code currentNodeId} as the edge source, which is how the graph discovers
 * its own topology from real traffic.
 */
public final class TraceContext {

    private static final ThreadLocal<TraceContext> CURRENT = new ThreadLocal<>();

    private final String traceId;
    private String currentNodeId;
    private long lastHitNanos;
    private Throwable lastError;

    private TraceContext(String traceId, String entryNodeId) {
        this.traceId = traceId;
        this.currentNodeId = entryNodeId;
        this.lastHitNanos = System.nanoTime();
    }

    /** Starts a context for the current thread, rooted at the given entry node. */
    public static TraceContext start(String entryNodeId) {
        TraceContext ctx = new TraceContext(UUID.randomUUID().toString(), entryNodeId);
        CURRENT.set(ctx);
        return ctx;
    }

    /** The context bound to the current thread, or {@code null} outside a request. */
    public static TraceContext current() {
        return CURRENT.get();
    }

    /** Removes the context from the current thread. Must be called in a finally block. */
    public static void clear() {
        CURRENT.remove();
    }

    /**
     * Binds an existing context to the current thread (used by reactive context propagation,
     * which restores a stored context onto whatever thread runs the next operator). Passing
     * {@code null} clears the binding.
     */
    public static void set(TraceContext ctx) {
        if (ctx == null) {
            CURRENT.remove();
        } else {
            CURRENT.set(ctx);
        }
    }

    public String traceId() {
        return traceId;
    }

    public String currentNodeId() {
        return currentNodeId;
    }

    public void currentNodeId(String id) {
        this.currentNodeId = id;
    }

    /** {@code System.nanoTime()} of the last hit (or context start), used to time edges. */
    public long lastHitNanos() {
        return lastHitNanos;
    }

    public void lastHitNanos(long nanos) {
        this.lastHitNanos = nanos;
    }

    /**
     * Marks {@code t} as recorded and reports whether it is new to this request. Used to dedup a
     * single exception that unwinds through several {@code @TracePoint} methods (each fires
     * {@code @AfterThrowing} with the same object) — only the first, deepest one is recorded.
     */
    public boolean markErrorIfNew(Throwable t) {
        if (lastError == t) {
            return false;
        }
        lastError = t;
        return true;
    }
}
