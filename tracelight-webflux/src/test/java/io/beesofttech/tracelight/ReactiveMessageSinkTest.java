package io.beesofttech.tracelight;

import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

import org.junit.jupiter.api.Test;

class ReactiveMessageSinkTest {

    @Test
    void broadcastReachesASubscribedClient() {
        ReactiveMessageSink sink = new ReactiveMessageSink();

        Flux<String> client = sink.asFlux();

        StepVerifier.create(client)
                .then(() -> sink.broadcast("{\"type\":\"pulse\"}"))
                .expectNext("{\"type\":\"pulse\"}")
                .then(() -> sink.broadcast("{\"type\":\"reset\"}"))
                .expectNext("{\"type\":\"reset\"}")
                .thenCancel()
                .verify();
    }

    @Test
    void broadcastWithNoSubscribersIsDropped() {
        ReactiveMessageSink sink = new ReactiveMessageSink();
        // Must not throw when nobody is listening.
        sink.broadcast("{\"type\":\"pulse\"}");
    }
}
