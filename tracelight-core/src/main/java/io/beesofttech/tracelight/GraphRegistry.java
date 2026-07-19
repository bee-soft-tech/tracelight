package io.beesofttech.tracelight;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.LongAccumulator;
import java.util.concurrent.atomic.LongAdder;

/**
 * Thread-safe in-memory store of the discovered graph: nodes (points), edges
 * (transitions between consecutive points) and per-node hit counters.
 *
 * <p>Holds only the live picture — there is no history.
 */
public class GraphRegistry {

    public static final String ENTRY_ID = "ENTRY";

    /** A point in the code. {@code kind} is {@code "entry"}, {@code "point"} or {@code "error"}. */
    public static final class NodeState {
        final String id;
        final String label;
        final String kind;
        final AtomicLong count = new AtomicLong();
        // Set once, on first sight, for error nodes only.
        volatile String message;
        volatile List<String> stack;

        NodeState(String id, String label, String kind) {
            this.id = id;
            this.label = label;
            this.kind = kind;
        }

        public String id() { return id; }
        public String label() { return label; }
        public String kind() { return kind; }
        public long count() { return count.get(); }
        /** Exception message for {@code "error"} nodes; {@code null} otherwise. */
        public String message() { return message; }
        /** Top stack frames for {@code "error"} nodes; {@code null} otherwise. */
        public List<String> stack() { return stack; }
    }

    /**
     * A directed transition {@code from -> to} discovered from traffic, plus the
     * cumulative latency of crossing it (min / avg / max over all timed samples
     * since the last reset).
     */
    public static final class EdgeState {
        final String id;
        final String from;
        final String to;

        private final LongAccumulator minNanos = new LongAccumulator(Math::min, Long.MAX_VALUE);
        private final LongAccumulator maxNanos = new LongAccumulator(Math::max, Long.MIN_VALUE);
        private final LongAdder sumNanos = new LongAdder();
        private final LongAdder samples = new LongAdder();

        EdgeState(String id, String from, String to) {
            this.id = id;
            this.from = from;
            this.to = to;
        }

        public String id() { return id; }
        public String from() { return from; }
        public String to() { return to; }

        /** Records one traversal latency. Negative values (no timing) are ignored. */
        void recordTiming(long nanos) {
            if (nanos < 0) {
                return;
            }
            minNanos.accumulate(nanos);
            maxNanos.accumulate(nanos);
            sumNanos.add(nanos);
            samples.increment();
        }

        void resetTiming() {
            minNanos.reset();
            maxNanos.reset();
            sumNanos.reset();
            samples.reset();
        }

        /** Number of timed samples since the last reset. */
        public long samples() { return samples.sum(); }

        public double minMs() { return samples() == 0 ? 0.0 : minNanos.get() / 1_000_000.0; }
        public double maxMs() { return samples() == 0 ? 0.0 : maxNanos.get() / 1_000_000.0; }
        public double avgMs() {
            long n = samples();
            return n == 0 ? 0.0 : sumNanos.sum() / (double) n / 1_000_000.0;
        }
    }

    /** Outcome of a single {@code hit}: the resolved edge, the new counter, and anything newly created. */
    public static final class HitResult {
        public final String from;
        public final String to;
        public final long count;
        /** Real latency of crossing this hop in nanoseconds, or {@code -1} when untimed. */
        public final long elapsedNanos;
        public final List<NodeState> newNodes;
        public final EdgeState newEdge; // null when the edge already existed

        HitResult(String from, String to, long count, long elapsedNanos, List<NodeState> newNodes, EdgeState newEdge) {
            this.from = from;
            this.to = to;
            this.count = count;
            this.elapsedNanos = elapsedNanos;
            this.newNodes = newNodes;
            this.newEdge = newEdge;
        }
    }

    private final Map<String, NodeState> nodes = new ConcurrentHashMap<>();
    private final Map<String, EdgeState> edges = new ConcurrentHashMap<>();

    /**
     * Ensures an entry node exists (e.g. {@code "GET /order"}).
     *
     * @return the node if it was just created, otherwise {@code null}
     */
    public NodeState ensureEntry(String id, String label) {
        boolean[] created = {false};
        NodeState node = nodes.computeIfAbsent(id, k -> {
            created[0] = true;
            return new NodeState(k, label, "entry");
        });
        return created[0] ? node : null;
    }

    /**
     * Counts one request arriving at an existing entry node. Entry nodes are otherwise only ever
     * the {@code from} of a hit — {@link #recordHit} increments only the target — so without this
     * their counter would sit at 0 forever. No-op returning 0 if the id is unknown.
     */
    public long recordEntryHit(String entryId) {
        NodeState n = nodes.get(entryId);
        return n == null ? 0 : n.count.incrementAndGet();
    }

    /** Equivalent to {@link #recordHit(String, String, long)} without timing. */
    public HitResult recordHit(String name, String fromOrNull) {
        return recordHit(name, fromOrNull, -1);
    }

    /**
     * Records a hit on {@code name}, coming from {@code fromOrNull} (or the generic
     * {@link #ENTRY_ID} when null). Creates the target node and the edge on first sight.
     * When {@code elapsedNanos >= 0} it is recorded as the latency of crossing the edge.
     */
    public HitResult recordHit(String name, String fromOrNull, long elapsedNanos) {
        var newNodes = new ArrayList<NodeState>(2);
        var from = (fromOrNull != null && !fromOrNull.isEmpty()) ? fromOrNull : ENTRY_ID;

        nodes.computeIfAbsent(from, k -> {
            NodeState n = new NodeState(k, k, ENTRY_ID.equals(k) ? "entry" : "point");
            newNodes.add(n);
            return n;
        });

        var target = nodes.computeIfAbsent(name, k -> {
            NodeState n = new NodeState(k, k, "point");
            newNodes.add(n);
            return n;
        });
        long count = target.count.incrementAndGet();

        var edgeId = from + "->" + name;
        EdgeState[] newEdge = {null};
        var edge = edges.computeIfAbsent(edgeId, k -> {
            var e = new EdgeState(k, from, name);
            newEdge[0] = e;
            return e;
        });
        edge.recordTiming(elapsedNanos);

        return new HitResult(from, name, count, elapsedNanos, newNodes, newEdge[0]);
    }

    /**
     * Records an exception thrown at {@code from}: creates (on first sight) a red {@code "error"}
     * node {@code from + "!" + simpleName} carrying {@code message}/{@code stack}, plus the edge
     * {@code from -> errorNode}, and increments the error node's counter. The stored message/stack
     * come from the first occurrence; later ones only bump the counter.
     */
    public HitResult recordError(String from, String simpleName, String message, List<String> stack) {
        var newNodes = new ArrayList<NodeState>(2);
        var fromId = (from != null && !from.isEmpty()) ? from : ENTRY_ID;

        nodes.computeIfAbsent(fromId, k -> {
            NodeState n = new NodeState(k, k, ENTRY_ID.equals(k) ? "entry" : "point");
            newNodes.add(n);
            return n;
        });

        var errorId = fromId + "!" + simpleName;
        var errNode = nodes.computeIfAbsent(errorId, k -> {
            NodeState n = new NodeState(k, simpleName, "error");
            n.message = message;
            n.stack = stack;
            newNodes.add(n);
            return n;
        });
        long count = errNode.count.incrementAndGet();

        var edgeId = fromId + "->" + errorId;
        EdgeState[] newEdge = {null};
        edges.computeIfAbsent(edgeId, k -> {
            var e = new EdgeState(k, fromId, errorId);
            newEdge[0] = e;
            return e;
        });

        return new HitResult(fromId, errorId, count, -1, newNodes, newEdge[0]);
    }

    public Collection<NodeState> nodes() {
        return nodes.values();
    }

    /** The node with the given id, or {@code null} if unknown. */
    public NodeState node(String id) {
        return nodes.get(id);
    }

    public Collection<EdgeState> edges() {
        return edges.values();
    }

    /** The edge with the given id, or {@code null} if unknown. */
    public EdgeState edge(String id) {
        return edges.get(id);
    }

    /** Zeroes all node counters and edge timing; keeps the discovered topology. */
    public void resetCounters() {
        for (NodeState n : nodes.values()) {
            n.count.set(0);
        }
        for (EdgeState e : edges.values()) {
            e.resetTiming();
        }
    }
}
