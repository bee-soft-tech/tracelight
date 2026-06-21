package io.tracelight;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * Serializes graph events to JSON and broadcasts them to all connected UI clients.
 *
 * <p>Topology and snapshot events are sent synchronously (rare, must not be lost).
 * High-frequency {@code pulse} events are dispatched on a single daemon thread with
 * a bounded queue; under overload they are dropped (sampled) so request threads and
 * the UI are never blocked.
 */
public class TracelightBroadcaster {

    private final GraphRegistry registry;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet();
    private final ThreadPoolExecutor pulseExecutor;

    public TracelightBroadcaster(GraphRegistry registry) {
        this.registry = registry;
        this.pulseExecutor = new ThreadPoolExecutor(
                1, 1, 0L, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(10_000),
                r -> {
                    Thread t = new Thread(r, "tracelight-ws");
                    t.setDaemon(true);
                    return t;
                },
                new ThreadPoolExecutor.DiscardPolicy());
    }

    public void register(WebSocketSession session) {
        sessions.add(session);
        sendTo(session, snapshotJson());
    }

    public void remove(WebSocketSession session) {
        sessions.remove(session);
    }

    /** Emits topology (for any newly created node/edge) then a pulse event. */
    public void onHit(GraphRegistry.HitResult result, String traceId) {
        if (!result.newNodes.isEmpty() || result.newEdge != null) {
            ObjectNode topo = mapper.createObjectNode();
            topo.put("type", "topology");
            ArrayNode nodes = topo.putArray("nodes");
            for (GraphRegistry.NodeState n : result.newNodes) {
                nodes.add(nodeJson(n));
            }
            if (result.newEdge != null) {
                topo.putArray("edges").add(edgeJson(result.newEdge));
            }
            broadcast(topo.toString());
        }

        ObjectNode pulse = mapper.createObjectNode();
        pulse.put("type", "pulse");
        pulse.put("traceId", traceId);
        pulse.put("from", result.from);
        pulse.put("to", result.to);
        pulse.put("count", result.count);
        String json = pulse.toString();
        pulseExecutor.execute(() -> broadcast(json));
    }

    /** Broadcasts a single newly created node (used by the request filter for entry nodes). */
    public void onTopologyNode(GraphRegistry.NodeState node) {
        ObjectNode topo = mapper.createObjectNode();
        topo.put("type", "topology");
        topo.putArray("nodes").add(nodeJson(node));
        broadcast(topo.toString());
    }

    /** Zeroes counters and tells clients to do the same. */
    public void reset() {
        registry.resetCounters();
        ObjectNode ev = mapper.createObjectNode();
        ev.put("type", "reset");
        broadcast(ev.toString());
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
        return o;
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
