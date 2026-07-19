package io.beesofttech.tracelight;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.LongAdder;

/**
 * Serializes graph events to JSON and broadcasts them to all connected UI clients.
 *
 * <p>Topology and snapshot events are always sent immediately (rare, must not be lost).
 * Hit traffic is handled in one of two modes, chosen by {@code flushIntervalMs}:
 * <ul>
 *   <li><b>batched</b> ({@code > 0}, the default): hits are coalesced and flushed once
 *       per window as a single {@code batch} event — keeps WS volume flat under heavy load.</li>
 *   <li><b>immediate</b> ({@code 0}): one {@code pulse} event per hit, dispatched on a
 *       single daemon thread with a bounded, drop-on-overload queue.</li>
 * </ul>
 */
public class TracelightBroadcaster implements AutoCloseable {

    /** Accumulated hits on one edge during a flush window. */
    private static final class EdgeAcc {
        final String from;
        final String to;
        final LongAdder adder = new LongAdder();

        EdgeAcc(String from, String to) {
            this.from = from;
            this.to = to;
        }
    }

    private final GraphRegistry registry;
    private final long flushIntervalMs;
    private final ObjectMapper mapper = new ObjectMapper();
    private final MessageSink sink;

    private final ThreadPoolExecutor pulseExecutor;
    private final ScheduledExecutorService scheduler;

    private final Map<String, LongAdder> nodeDeltas = new ConcurrentHashMap<>();
    private final Map<String, EdgeAcc> edgeDeltas = new ConcurrentHashMap<>();

    public TracelightBroadcaster(GraphRegistry registry, long flushIntervalMs, MessageSink sink) {
        this.registry = registry;
        this.flushIntervalMs = flushIntervalMs;
        this.sink = sink;

        ThreadFactory daemon = r -> {
            Thread t = new Thread(r, "tracelight-ws");
            t.setDaemon(true);
            return t;
        };
        this.pulseExecutor = new ThreadPoolExecutor(
                1, 1, 0L, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(10_000),
                daemon,
                new ThreadPoolExecutor.DiscardPolicy());

        if (flushIntervalMs > 0) {
            this.scheduler = Executors.newSingleThreadScheduledExecutor(daemon);
            this.scheduler.scheduleAtFixedRate(this::flush, flushIntervalMs, flushIntervalMs, TimeUnit.MILLISECONDS);
        } else {
            this.scheduler = null;
        }
    }

    /** Emits topology immediately for anything new; then either accumulates or pulses the hit. */
    public void onHit(GraphRegistry.HitResult result, String traceId) {
        if (!result.newNodes.isEmpty() || result.newEdge != null) {
            var topo = mapper.createObjectNode();
            topo.put("type", "topology");
            var nodes = topo.putArray("nodes");
            for (GraphRegistry.NodeState n : result.newNodes) {
                nodes.add(nodeJson(n));
            }
            if (result.newEdge != null) {
                topo.putArray("edges").add(edgeJson(result.newEdge));
            }
            broadcast(topo.toString());
        }

        if (flushIntervalMs > 0) {
            nodeDeltas.computeIfAbsent(result.to, k -> new LongAdder()).increment();
            String edgeId = result.from + "->" + result.to;
            edgeDeltas.computeIfAbsent(edgeId, k -> new EdgeAcc(result.from, result.to)).adder.increment();
        } else {
            ObjectNode pulse = mapper.createObjectNode();
            pulse.put("type", "pulse");
            pulse.put("traceId", traceId);
            pulse.put("from", result.from);
            pulse.put("to", result.to);
            pulse.put("count", result.count);
            // This hop's own real latency (ms), for per-request slow-motion replay. Aggregate
            // edge min/avg/max still ride along via addTiming below.
            if (result.elapsedNanos >= 0) {
                pulse.put("ms", result.elapsedNanos / 1_000_000.0);
            }
            addTiming(pulse, registry.edge(result.from + "->" + result.to));
            String json = pulse.toString();
            pulseExecutor.execute(() -> broadcast(json));
        }
    }

    /**
     * The request filter started monitoring a request. Emits an {@code open} frame — a pure
     * UI trigger (creates the request's playback queue client-side; never a graph node).
     * Routed through the same single-thread executor as pulses so lifecycle frames stay
     * ordered with the request's hits. No-op in batched mode, which has no per-request identity.
     */
    public void onTraceOpen(String traceId, String entryId) {
        if (flushIntervalMs > 0) {
            return;
        }
        ObjectNode ev = mapper.createObjectNode();
        ev.put("type", "open");
        ev.put("traceId", traceId);
        ev.put("entry", entryId);
        String json = ev.toString();
        pulseExecutor.execute(() -> broadcast(json));
    }

    /**
     * The request finished: records the terminal hop from the last node hit to the dark
     * {@code "Return <entry>"} node (created on first sight, entry-styled — the visible end
     * of the route), then emits the {@code close} frame that tells the UI to drop the
     * request's playback queue. The terminal hop is a regular hit, so it animates, counts
     * completed requests, and its edge timing shows the gap between the last point and
     * request completion. Skipped when the request hit no {@code @TracePoint}
     * ({@code lastNodeId == entryId}), so e.g. CORS preflights don't grow return nodes.
     */
    public void onTraceComplete(String traceId, String lastNodeId, String entryId, long lastHitNanos) {
        if (lastNodeId != null && !lastNodeId.equals(entryId)) {
            String returnId = "Return " + entryId;
            GraphRegistry.NodeState created = registry.ensureEntry(returnId, returnId);
            if (created != null) {
                onTopologyNode(created);
            }
            onHit(registry.recordHit(returnId, lastNodeId, System.nanoTime() - lastHitNanos), traceId);
        }
        onTraceClose(traceId, lastNodeId, entryId);
    }

    /**
     * Emits the {@code close} frame carrying the last node hit ({@code from}) and the entry
     * node ({@code to}) — the UI deletes the request's playback queue once it drains.
     * Ordering and batched-mode behavior as in {@link #onTraceOpen}.
     */
    void onTraceClose(String traceId, String lastNodeId, String entryId) {
        if (flushIntervalMs > 0) {
            return;
        }
        ObjectNode ev = mapper.createObjectNode();
        ev.put("type", "close");
        ev.put("traceId", traceId);
        ev.put("from", lastNodeId);
        ev.put("to", entryId);
        String json = ev.toString();
        pulseExecutor.execute(() -> broadcast(json));
    }

    /**
     * Records one request arriving at an entry node so its counter climbs in the UI (entry nodes
     * are never a hit target, so nothing else counts them). No edge is involved, so nothing
     * animates: in batched mode the entry joins the next window's node counts; in immediate mode
     * it is sent as a single node-only {@code batch} frame, ordered on the pulse executor with the
     * request's hits.
     */
    public void onEntryHit(String entryId, long count) {
        if (flushIntervalMs > 0) {
            nodeDeltas.computeIfAbsent(entryId, k -> new LongAdder()).increment();
            return;
        }
        ObjectNode batch = mapper.createObjectNode();
        batch.put("type", "batch");
        ObjectNode o = batch.putArray("nodes").addObject();
        o.put("id", entryId);
        o.put("count", count);
        o.put("delta", 1);
        batch.putArray("edges");
        String json = batch.toString();
        pulseExecutor.execute(() -> broadcast(json));
    }

    /** Builds and sends one aggregated {@code batch} event, clearing the window. */
    private void flush() {
        try {
            if (nodeDeltas.isEmpty() && edgeDeltas.isEmpty()) {
                return;
            }

            ObjectNode batch = mapper.createObjectNode();
            batch.put("type", "batch");

            ArrayNode nodes = batch.putArray("nodes");
            for (String id : Set.copyOf(nodeDeltas.keySet())) {
                LongAdder adder = nodeDeltas.remove(id);
                if (adder == null) {
                    continue;
                }
                GraphRegistry.NodeState node = registry.node(id);
                ObjectNode o = nodes.addObject();
                o.put("id", id);
                o.put("count", node != null ? node.count() : 0);
                o.put("delta", adder.sum());
            }

            ArrayNode edges = batch.putArray("edges");
            for (String id : Set.copyOf(edgeDeltas.keySet())) {
                EdgeAcc acc = edgeDeltas.remove(id);
                if (acc == null) {
                    continue;
                }
                ObjectNode o = edges.addObject();
                o.put("id", id);
                o.put("from", acc.from);
                o.put("to", acc.to);
                o.put("delta", acc.adder.sum());
                addTiming(o, registry.edge(id));
            }

            broadcast(batch.toString());
        } catch (RuntimeException ex) {
            // never let a flush failure kill the scheduler
        }
    }

    /** Broadcasts a single newly created node (used by the request filter for entry nodes). */
    public void onTopologyNode(GraphRegistry.NodeState node) {
        ObjectNode topo = mapper.createObjectNode();
        topo.put("type", "topology");
        topo.putArray("nodes").add(nodeJson(node));
        broadcast(topo.toString());
    }

    /** Zeroes counters, drops any pending deltas, and tells clients to do the same. */
    public void reset() {
        registry.resetCounters();
        nodeDeltas.clear();
        edgeDeltas.clear();
        ObjectNode ev = mapper.createObjectNode();
        ev.put("type", "reset");
        broadcast(ev.toString());
    }

    @Override
    public void close() {
        if (scheduler != null) {
            scheduler.shutdownNow();
        }
        pulseExecutor.shutdownNow();
    }

    public String snapshotJson() {
        ObjectNode snap = mapper.createObjectNode();
        snap.put("type", "snapshot");
        ArrayNode nodes = snap.putArray("nodes");
        for (GraphRegistry.NodeState n : registry.nodes()) {
            nodes.add(nodeJson(n));
        }
        ArrayNode edges = snap.putArray("edges");
        for (GraphRegistry.EdgeState e : registry.edges()) {
            edges.add(edgeJson(e));
        }
        return snap.toString();
    }

    private ObjectNode nodeJson(GraphRegistry.NodeState n) {
        ObjectNode o = mapper.createObjectNode();
        o.put("id", n.id());
        o.put("label", n.label());
        o.put("kind", n.kind());
        o.put("count", n.count());
        if ("error".equals(n.kind())) {
            o.put("message", n.message());
            ArrayNode stack = o.putArray("stack");
            if (n.stack() != null) {
                n.stack().forEach(stack::add);
            }
        }
        return o;
    }

    private ObjectNode edgeJson(GraphRegistry.EdgeState e) {
        ObjectNode o = mapper.createObjectNode();
        o.put("id", e.id());
        o.put("from", e.from());
        o.put("to", e.to());
        addTiming(o, e);
        return o;
    }

    /** Adds {@code min}/{@code avg}/{@code max} (ms) and {@code samples} when the edge has been timed. */
    private void addTiming(ObjectNode o, GraphRegistry.EdgeState e) {
        if (e == null || e.samples() == 0) {
            return;
        }
        o.put("min", e.minMs());
        o.put("avg", e.avgMs());
        o.put("max", e.maxMs());
        o.put("samples", e.samples());
    }

    private void broadcast(String json) {
        sink.broadcast(json);
    }
}
