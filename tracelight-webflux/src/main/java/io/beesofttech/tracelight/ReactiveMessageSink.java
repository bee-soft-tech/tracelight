package io.beesofttech.tracelight;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Sinks;

/**
 * Reactive {@link MessageSink}: a single hot, multi-subscriber stream of JSON frames.
 * Each connected WebSocket session subscribes to {@link #asFlux()}. Emission is best-effort —
 * when there are no subscribers, or a subscriber cannot keep up, frames are dropped (this is a
 * live visualizer, mirroring the servlet adapter's drop-on-overload policy).
 *
 * <p>A {@code Sinks.Many} does not permit concurrent {@code tryEmitNext} calls: overlapping
 * emissions fail with {@link Sinks.EmitResult#FAIL_NON_SERIALIZED} and the frame is dropped.
 * Under large-scale traffic many recording threads broadcast at once (each new node/edge emits a
 * topology frame directly on the recording thread), so without serialization the sink drops the
 * vast majority of frames — including the one-shot topology frames — leaving routes and edges
 * missing in the UI. {@link #broadcast(String)} is therefore serialized with a lock, so the only
 * remaining drops are genuine backpressure ({@code FAIL_OVERFLOW}) or "no UI connected"
 * ({@code FAIL_ZERO_SUBSCRIBER}). This mirrors the servlet sink, which serializes sends per session.
 */
public class ReactiveMessageSink implements MessageSink {

    private final Sinks.Many<String> sink = Sinks.many().multicast().directBestEffort();
    private final Object emitLock = new Object();

    @Override
    public void broadcast(String json) {
        // Serialize emission: a Sinks.Many forbids concurrent tryEmitNext (FAIL_NON_SERIALIZED).
        // Remaining failures (FAIL_ZERO_SUBSCRIBER / FAIL_OVERFLOW) mean "drop", which is fine here.
        synchronized (emitLock) {
            sink.tryEmitNext(json);
        }
    }

    /** Hot stream of frames; each subscriber receives frames emitted after it subscribes. */
    public Flux<String> asFlux() {
        return sink.asFlux();
    }
}
