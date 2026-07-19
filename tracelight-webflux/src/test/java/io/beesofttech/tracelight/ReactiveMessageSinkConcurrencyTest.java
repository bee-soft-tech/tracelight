package io.beesofttech.tracelight;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Flux;

/**
 * Evidence: {@link ReactiveMessageSink} is backed by a {@code directBestEffort} multicast sink,
 * whose {@code tryEmitNext} must be serialized. When many recording threads broadcast frames
 * concurrently (the large-scale-traffic case), overlapping emissions fail with
 * {@code FAIL_NON_SERIALIZED} and the frame is silently dropped -- even though the single WS
 * subscriber has unbounded demand and is infinitely fast. Dropped topology frames are exactly
 * why nodes/edges go missing in the WebFlux UI but not the servlet UI.
 */
class ReactiveMessageSinkConcurrencyTest {

    @Test
    void concurrentBroadcastsDropFramesEvenWithUnboundedDemand() throws Exception {
        ReactiveMessageSink sink = new ReactiveMessageSink();

        // A fast, unbounded subscriber: it can never be the bottleneck.
        ConcurrentLinkedQueue<String> received = new ConcurrentLinkedQueue<>();
        Flux.from(sink.asFlux()).subscribe(received::add);

        int threads = 16;
        int perThread = 500;
        int total = threads * perThread;

        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(threads);
        for (int t = 0; t < threads; t++) {
            final int base = t * perThread;
            pool.submit(() -> {
                try {
                    start.await();
                    for (int i = 0; i < perThread; i++) {
                        sink.broadcast("frame-" + (base + i));
                    }
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                } finally {
                    done.countDown();
                }
            });
        }
        start.countDown();
        done.await(30, TimeUnit.SECONDS);
        pool.shutdownNow();

        Thread.sleep(200); // let the subscriber drain anything in flight

        System.out.println("=== emitted " + total + ", received " + received.size()
                + ", DROPPED " + (total - received.size()) + " ===");

        // The bug: with a directBestEffort multicast sink and concurrent emission, frames are lost.
        assertThat(received.size())
                .as("a reliable sink would deliver every frame to an unbounded subscriber")
                .isEqualTo(total);
    }
}
