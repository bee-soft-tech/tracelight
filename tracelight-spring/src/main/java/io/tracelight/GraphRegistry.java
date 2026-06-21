package io.tracelight;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Thread-safe in-memory store of the discovered graph: nodes (points), edges
 * (transitions between consecutive points) and per-node hit counters.
 *
 * <p>Holds only the live picture — there is no history.
 */
public class GraphRegistry {

    public static final String ENTRY_ID = "ENTRY";

    /** A point in the code. {@code kind} is {@code "entry"} or {@code "point"}. */
    public static final class NodeState {
        final String id;
        final String label;
        final String kind;
        final AtomicLong count = new AtomicLong();

        NodeState(String id, String label, String kind) {
            this.id = id;
            this.label = label;
            this.kind = kind;
        }

        public String id() { return id; }
        public String label() { return label; }
        public String kind() { return kind; }
        public long count() { return count.get(); }
    }

    /** A directed transition {@code from -> to} discovered from traffic. */
    public static final class EdgeState {
        final String id;
        final String from;
        final String to;

        EdgeState(String id, String from, String to) {
            this.id = id;
            this.from = from;
            this.to = to;
        }

        public String id() { return id; }
        public String from() { return from; }
        public String to() { return to; }
    }

    /** Outcome of a single {@code hit}: the resolved edge, the new counter, and anything newly created. */
    public static final class HitResult {
        public final String from;
        public final String to;
        public final long count;
        public final List<NodeState> newNodes;
        public final EdgeState newEdge; // null when the edge already existed

        HitResult(String from, String to, long count, List<NodeState> newNodes, EdgeState newEdge) {
            this.from = from;
            this.to = to;
            this.count = count;
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
     * Records a hit on {@code name}, coming from {@code fromOrNull} (or the generic
     * {@link #ENTRY_ID} when null). Creates the target node and the edge on first sight.
     */
    public HitResult recordHit(String name, String fromOrNull) {
        List<NodeState> newNodes = new ArrayList<>(2);
        String from = (fromOrNull != null && !fromOrNull.isEmpty()) ? fromOrNull : ENTRY_ID;

        nodes.computeIfAbsent(from, k -> {
            NodeState n = new NodeState(k, k, ENTRY_ID.equals(k) ? "entry" : "point");
            newNodes.add(n);
            return n;
        });

        NodeState target = nodes.computeIfAbsent(name, k -> {
            NodeState n = new NodeState(k, k, "point");
            newNodes.add(n);
            return n;
        });
        long count = target.count.incrementAndGet();

        String edgeId = from + "->" + name;
        EdgeState[] newEdge = {null};
        edges.computeIfAbsent(edgeId, k -> {
            EdgeState e = new EdgeState(k, from, name);
            newEdge[0] = e;
            return e;
        });

        return new HitResult(from, name, count, newNodes, newEdge[0]);
    }

    public Collection<NodeState> nodes() {
        return nodes.values();
    }

    public Collection<EdgeState> edges() {
        return edges.values();
    }

    /** Zeroes all counters; keeps the discovered topology. */
    public void resetCounters() {
        for (NodeState n : nodes.values()) {
            n.count.set(0);
        }
    }
}
