package io.beesofttech.tracelight.demo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import io.beesofttech.tracelight.GraphRegistry;
import java.net.URI;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.reactive.socket.client.ReactorNettyWebSocketClient;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class DemoIntegrationTest {

    @Autowired WebTestClient webTestClient;
    @Autowired GraphRegistry registry;
    @LocalServerPort int port;

    @Test
    void orderFlowIsDiscoveredAcrossThreadHops() {
        webTestClient.post().uri("/order")
                .bodyValue(new Order(120, true, "US"))
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.status").isEqualTo("ok");

        // Nodes recorded by Tracelight.hit() inside publishOn'd operators prove context propagation.
        await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> {
            assertThat(registry.node("GET /order")).isNull(); // POST, not GET
            assertThat(registry.node("POST /order")).isNotNull();
            assertThat(registry.node("validate")).isNotNull();
            assertThat(registry.node("valid")).isNotNull();
            assertThat(registry.node("premium-discount")).isNotNull();
            assertThat(registry.node("ship-us")).isNotNull();
        });
    }

    @Test
    void largeChargeProducesAnErrorNode() {
        webTestClient.post().uri("/order")
                .bodyValue(new Order(2500, false, "PL"))
                .exchange()
                .expectStatus().is5xxServerError();

        // Last Tracelight.hit() before the throw is "fraud-check" (payment -> standard-price ->
        // fraud-check -> throw), so the error node is keyed off that node, not "payment".
        await().atMost(Duration.ofSeconds(2)).untilAsserted(() ->
                assertThat(registry.node("fraud-check!IllegalStateException")).isNotNull());
    }

    @Test
    void webSocketSendsSnapshotAsFirstFrame() {
        // Seed some topology so the snapshot is non-trivial.
        webTestClient.get().uri("/search?q=hello").exchange().expectStatus().isOk();

        var client = new ReactorNettyWebSocketClient();
        var uri = URI.create("ws://localhost:" + port + "/tracelight/ws");
        var firstFrame = new AtomicReference<String>();

        client.execute(uri, session ->
                session.receive()
                        .next()
                        .doOnNext(msg -> firstFrame.set(msg.getPayloadAsText()))
                        .then())
                .block(Duration.ofSeconds(5));

        assertThat(firstFrame.get()).contains("\"type\":\"snapshot\"");
    }
}
