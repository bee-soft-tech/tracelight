package io.beesofttech.tracelight;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicReference;

import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

import org.junit.jupiter.api.Test;

class TracelightReactiveWebSocketHandlerTest {

    @Test
    void snapshotIsTheFirstFrameThenLiveStreamFollows() {
        Flux<String> live = Flux.just("{\"type\":\"pulse\"}", "{\"type\":\"batch\"}");
        AtomicReference<Disposable> subscription = new AtomicReference<>();

        Flux<String> out = TracelightReactiveWebSocketHandler.outboundJson(
                () -> "{\"type\":\"snapshot\"}", live, subscription::set);

        StepVerifier.create(out)
                .expectNext("{\"type\":\"snapshot\"}")
                .expectNext("{\"type\":\"pulse\"}")
                .expectNext("{\"type\":\"batch\"}")
                .verifyComplete();

        subscription.get().dispose();
    }

    /**
     * GREEN: the point of the fix. `outboundJson` eagerly subscribes the live sink at call time --
     * before the returned flux is ever subscribed and before the snapshot is even captured. A
     * frame broadcast in that handoff window (no outbound subscriber yet) must still be delivered,
     * buffered behind the snapshot, rather than silently dropped by the directBestEffort sink.
     */
    @Test
    void frameBroadcastDuringHandoffIsBufferedAndDelivered() {
        ReactiveMessageSink sink = new ReactiveMessageSink();
        AtomicReference<Disposable> subscription = new AtomicReference<>();

        // Calling outboundJson eagerly subscribes to sink.asFlux() right here, even though `out`
        // itself is not subscribed until the StepVerifier.create(...) below.
        Flux<String> out = TracelightReactiveWebSocketHandler.outboundJson(
                () -> "{\"type\":\"snapshot\"}", sink.asFlux(), subscription::set);

        // Handoff window: broadcast happens after the eager subscription exists, but before `out`
        // has a subscriber. With the old (String, Flux) seam this frame would be dropped.
        sink.broadcast("{\"type\":\"pulse\",\"marker\":1}");

        StepVerifier.create(out)
                .expectNext("{\"type\":\"snapshot\"}")
                .expectNext("{\"type\":\"pulse\",\"marker\":1}")
                .thenCancel()
                .verify(Duration.ofSeconds(2));

        subscription.get().dispose();
    }

    /**
     * Preserves the original slow-client behavior: the live buffer is bounded and drops the
     * OLDEST frame on overflow rather than growing unbounded, erroring, or disconnecting. We
     * publish more than LIVE_BUFFER_CAPACITY frames before ever subscribing (worst case: a client
     * that never catches up), then subscribe and confirm the stream is still alive, has dropped
     * the earliest overflow frames, and continues to deliver frames broadcast afterwards.
     */
    @Test
    void liveBufferDropsOldestOnOverflowInsteadOfGrowingOrErroring() {
        ReactiveMessageSink sink = new ReactiveMessageSink();
        AtomicReference<Disposable> subscription = new AtomicReference<>();

        Flux<String> out = TracelightReactiveWebSocketHandler.outboundJson(
                () -> "{\"type\":\"snapshot\"}", sink.asFlux(), subscription::set);

        int capacity = TracelightReactiveWebSocketHandler.LIVE_BUFFER_CAPACITY;
        int overflowBy = 10;
        for (int i = 0; i < capacity + overflowBy; i++) {
            sink.broadcast("{\"type\":\"pulse\",\"marker\":" + i + "}");
        }

        StepVerifier.Step<String> steps = StepVerifier.create(out)
                .expectNext("{\"type\":\"snapshot\"}");

        // The first `overflowBy` markers (0..9) must have been dropped as "oldest"; the buffer
        // should start replaying from marker `overflowBy` (10) through `capacity + overflowBy - 1`.
        for (int i = overflowBy; i < capacity + overflowBy; i++) {
            steps = steps.expectNext("{\"type\":\"pulse\",\"marker\":" + i + "}");
        }

        // The stream must still be alive (no error, no completion) and keep delivering new frames.
        // NB: StepVerifier.create(...) does not subscribe until verify() runs the sequence, so this
        // broadcast must happen via .then(...) -- scheduled once the prior expectations have actually
        // been consumed -- rather than before verify(), or it would land in the pre-subscription
        // handoff buffer instead of being a genuinely "live, post-subscription" emission.
        steps.then(() -> sink.broadcast("{\"type\":\"pulse\",\"marker\":\"after-overflow\"}"))
                .expectNext("{\"type\":\"pulse\",\"marker\":\"after-overflow\"}")
                .thenCancel()
                .verify(Duration.ofSeconds(2));

        subscription.get().dispose();
    }
}
