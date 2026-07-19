package io.beesofttech.tracelight;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

class TraceFilterTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final GraphRegistry registry = new GraphRegistry();
    private final CollectingSink sink = new CollectingSink();
    private final TracelightBroadcaster broadcaster = new TracelightBroadcaster(registry, 0, sink);
    private final TraceFilter filter = new TraceFilter(registry, broadcaster, "/tracelight");

    /** Collects broadcast frames; open/close/pulse arrive async on the pulse executor. */
    private static final class CollectingSink implements MessageSink {
        final java.util.List<String> frames = java.util.Collections.synchronizedList(new java.util.ArrayList<>());

        @Override
        public void broadcast(String json) {
            frames.add(json);
        }

        void awaitFrames(int n) throws InterruptedException {
            long deadline = System.currentTimeMillis() + 2000;
            while (frames.size() < n && System.currentTimeMillis() < deadline) {
                Thread.sleep(5);
            }
        }
    }

    private java.util.List<JsonNode> framesOfType(String type) {
        return sink.frames.stream()
                .map(f -> {
                    try {
                        return mapper.readTree(f);
                    } catch (Exception e) {
                        throw new RuntimeException(e);
                    }
                })
                .filter(n -> type.equals(n.path("type").asText()))
                .toList();
    }

    @Test
    void emitsOneOpenAndOneCloseWithTheLastNodeHit() throws Exception {
        var request = new MockHttpServletRequest("POST", "/order");
        var recorder = new DefaultTraceRecorder(registry, broadcaster);

        // Chain body: the request hits one @TracePoint, so "svc" becomes the last node.
        filter.doFilter(request, new MockHttpServletResponse(), (req, res) -> recorder.hit("svc"));
        // topology(entry) + open + topology(svc) + pulse + topology(return node) +
        // topology(return edge) + pulse(return) + close
        sink.awaitFrames(8);

        var opens = framesOfType("open");
        assertThat(opens).hasSize(1);
        assertThat(opens.get(0).get("entry").asText()).isEqualTo("POST /order");

        var closes = framesOfType("close");
        assertThat(closes).hasSize(1);
        assertThat(closes.get(0).get("traceId").asText()).isEqualTo(opens.get(0).get("traceId").asText());
        assertThat(closes.get(0).get("from").asText()).isEqualTo("svc");
        assertThat(closes.get(0).get("to").asText()).isEqualTo("POST /order");

        // The terminal hop lands in the dark "Return <entry>" node as a regular pulse.
        assertThat(registry.node("Return POST /order").kind()).isEqualTo("entry");
        var pulses = framesOfType("pulse");
        assertThat(pulses).hasSize(2);
        assertThat(pulses.get(1).get("from").asText()).isEqualTo("svc");
        assertThat(pulses.get(1).get("to").asText()).isEqualTo("Return POST /order");
    }

    @Test
    void closeFallsBackToTheEntryNodeWhenNothingFired() throws Exception {
        var request = new MockHttpServletRequest("GET", "/ping");

        filter.doFilter(request, new MockHttpServletResponse(), (req, res) -> { });
        sink.awaitFrames(3); // topology(entry) + open + close

        var closes = framesOfType("close");
        assertThat(closes).hasSize(1);
        assertThat(closes.get(0).get("from").asText()).isEqualTo("GET /ping");
        assertThat(closes.get(0).get("to").asText()).isEqualTo("GET /ping");
        assertThat(registry.node("Return GET /ping")).isNull(); // no @TracePoint → no return node
    }

    @Test
    void closeIsEmittedEvenWhenTheChainThrows() throws Exception {
        var request = new MockHttpServletRequest("GET", "/boom");

        try {
            filter.doFilter(request, new MockHttpServletResponse(), (req, res) -> {
                throw new jakarta.servlet.ServletException("boom");
            });
        } catch (jakarta.servlet.ServletException expected) {
            // the filter must not swallow it
        }
        sink.awaitFrames(3); // topology(entry) + open + close

        assertThat(framesOfType("open")).hasSize(1);
        assertThat(framesOfType("close")).hasSize(1);
    }

    @Test
    void tracelightOwnEndpointsEmitNoLifecycle() throws Exception {
        var request = new MockHttpServletRequest("GET", "/tracelight/ws");

        filter.doFilter(request, new MockHttpServletResponse(), (req, res) -> { });
        Thread.sleep(50);

        assertThat(sink.frames).isEmpty();
    }
}
