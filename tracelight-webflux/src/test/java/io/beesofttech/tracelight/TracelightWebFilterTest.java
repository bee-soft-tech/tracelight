package io.beesofttech.tracelight;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;
import reactor.util.context.ContextView;

class TracelightWebFilterTest {

    private final GraphRegistry registry = new GraphRegistry();
    private final CollectingSink sink = new CollectingSink();
    private final TracelightBroadcaster broadcaster = new TracelightBroadcaster(registry, 0, sink);
    private final TracelightWebFilter filter =
            new TracelightWebFilter(registry, broadcaster, "/tracelight");

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

    /** A chain that captures the Reactor Context it is invoked with. */
    private static final class CapturingChain implements WebFilterChain {
        ContextView captured;
        @Override
        public Mono<Void> filter(org.springframework.web.server.ServerWebExchange exchange) {
            return Mono.deferContextual(ctx -> {
                this.captured = ctx;
                return Mono.empty();
            });
        }
    }

    @Test
    void tracedRequestCreatesEntryNodeAndSeedsContext() {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/order"));
        var chain = new CapturingChain();

        filter.filter(exchange, chain).block();

        assertThat(registry.node("GET /order")).isNotNull();
        assertThat(chain.captured.hasKey(TraceContextThreadLocalAccessor.KEY)).isTrue();
        TraceContext seeded = chain.captured.get(TraceContextThreadLocalAccessor.KEY);
        assertThat(seeded.currentNodeId()).isEqualTo("GET /order");
    }

    @Test
    void tracelightOwnEndpointsAreNotTraced() {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/tracelight/ws"));
        var chain = new CapturingChain();

        filter.filter(exchange, chain).block();

        assertThat(registry.node("GET /tracelight/ws")).isNull();
        assertThat(chain.captured.hasKey(TraceContextThreadLocalAccessor.KEY)).isFalse();
    }

    private java.util.List<com.fasterxml.jackson.databind.JsonNode> framesOfType(String type) {
        var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
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
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.post("/order"));
        // Chain body: advance the trace to "svc", as a downstream @TracePoint hit would.
        WebFilterChain chain = ex -> Mono.deferContextual(ctx -> {
            TraceContext seeded = ctx.get(TraceContextThreadLocalAccessor.KEY);
            seeded.currentNodeId("svc");
            return Mono.empty();
        });

        filter.filter(exchange, chain).block();
        // topology(entry) + open + topology(return node) + topology(svc + return edge) +
        // pulse(return) + close
        sink.awaitFrames(6);

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
        assertThat(pulses).hasSize(1);
        assertThat(pulses.get(0).get("from").asText()).isEqualTo("svc");
        assertThat(pulses.get(0).get("to").asText()).isEqualTo("Return POST /order");
    }

    @Test
    void closeIsEmittedOnError() throws Exception {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/boom"));
        WebFilterChain chain = ex -> Mono.error(new IllegalStateException("boom"));

        try {
            filter.filter(exchange, chain).block();
        } catch (IllegalStateException expected) {
            // the filter must not swallow it
        }
        sink.awaitFrames(3); // topology(entry) + open + close

        assertThat(framesOfType("open")).hasSize(1);
        var closes = framesOfType("close");
        assertThat(closes).hasSize(1);
        assertThat(closes.get(0).get("from").asText()).isEqualTo("GET /boom");
    }

    @Test
    void tracelightOwnEndpointsEmitNoLifecycle() throws Exception {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/tracelight/ws"));

        filter.filter(exchange, new CapturingChain()).block();
        Thread.sleep(50);

        assertThat(sink.frames).isEmpty();
    }
}
