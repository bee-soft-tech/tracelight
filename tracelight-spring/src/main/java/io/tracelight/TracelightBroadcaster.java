package io.tracelight;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
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
    private final Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet();

    private final ThreadPoolExecutor pulseExecutor;
    private final ScheduledExecutorService scheduler;

    private final Map<String, LongAdder> nodeDeltas = new ConcurrentHashMap<>();
    private final Map<String, EdgeAcc> edgeDeltas = new ConcurrentHashMap<>();

    public TracelightBroadcaster(GraphRegistry registry, long flushIntervalMs) {
        this.registry = registry;
        this.flushIntervalMs = flushIntervalMs;

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

    public void register(WebSocketSession session) {
        sessions.add(session);
        sendTo(session, snapshotJson());
    }

    public void remove(WebSocketSession session) {
        sessions.remove(session);
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
            addTiming(pulse, registry.edge(result.from + "->" + result.to));
            String json = pulse.toString();
            pulseExecutor.execute(() -> broadcast(json));
        }
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

    private String snapshotJson() {
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
        for (WebSocketSession session : sessions) {
            sendTo(session, json);
        }
    }

    private void sendTo(WebSocketSession session, String json) {
        if (!session.isOpen()) {
            sessions.remove(session);
            return;
        }
        try {
            // WebSocketSession is not safe for concurrent sends.
            synchronized (session) {
                session.sendMessage(new TextMessage(json));
            }
        } catch (IOException | IllegalStateException ex) {
            sessions.remove(session);
        }
    }
}
