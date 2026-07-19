package io.beesofttech.tracelight;

import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.function.Supplier;

import org.springframework.web.reactive.socket.WebSocketHandler;
import org.springframework.web.reactive.socket.WebSocketMessage;
import org.springframework.web.reactive.socket.WebSocketSession;
import reactor.core.Disposable;
import reactor.core.publisher.ConnectableFlux;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Reactive WebSocket endpoint. Each session first receives a full snapshot, then the live frame
 * stream from {@link ReactiveMessageSink}. Inbound {@code "reset"} messages zero the counters.
 *
 * <p>The live sink ({@link ReactiveMessageSink}, backed by a {@code directBestEffort} multicast)
 * drops emissions when it has no subscriber. To avoid losing frames broadcast in the window
 * between snapshot capture and the outbound flux actually being subscribed, the live stream is
 * subscribed <em>eagerly</em> (before the snapshot is even taken) into a small, bounded,
 * drop-oldest buffer -- see {@link #outboundJson}. This mirrors the servlet adapter's
 * add-session-then-snapshot ordering, at the cost of an occasional harmless duplicate (a frame
 * both reflected in the snapshot and re-delivered live).
 */
public class TracelightReactiveWebSocketHandler implements WebSocketHandler {

    /**
     * Bound on how many live frames are retained for a not-yet-subscribed (or slow) client.
     * Once exceeded, the oldest buffered frame is dropped -- preserving the original
     * directBestEffort adapter's "drop rather than grow unbounded or disconnect" policy for slow
     * clients, while still closing the snapshot/live handoff gap for the common case.
     */
    static final int LIVE_BUFFER_CAPACITY = 256;

    private final TracelightBroadcaster broadcaster;
    private final ReactiveMessageSink sink;

    public TracelightReactiveWebSocketHandler(TracelightBroadcaster broadcaster, ReactiveMessageSink sink) {
        this.broadcaster = broadcaster;
        this.sink = sink;
    }

    /**
     * Eagerly subscribes to {@code live}, buffering into a bounded, drop-oldest cache, so that no
     * frame is lost while nobody has subscribed to the returned flux yet. The snapshot is captured
     * only <em>after</em> that eager subscription is established, so a frame broadcast right after
     * the snapshot is taken is still buffered and delivered, never silently dropped.
     *
     * <p>{@code onSubscribed} is handed the {@link Disposable} for the eager subscription so the
     * caller can dispose it when the session terminates.
     *
     * <p>Package-private for unit testing.
     */
    static Flux<String> outboundJson(Supplier<String> snapshotSupplier, Flux<String> live, Consumer<Disposable> onSubscribed) {
        ConnectableFlux<String> buffered = live.replay(LIVE_BUFFER_CAPACITY);
        onSubscribed.accept(buffered.connect());

        String snapshot = snapshotSupplier.get();
        return Flux.concat(Mono.justOrEmpty(snapshot), buffered);
    }

    @Override
    public Mono<Void> handle(WebSocketSession session) {
        AtomicReference<Disposable> liveSubscription = new AtomicReference<>();

        Flux<WebSocketMessage> outbound =
                outboundJson(broadcaster::snapshotJson, sink.asFlux(), liveSubscription::set)
                        .map(session::textMessage)
                        .doFinally(signal -> {
                            Disposable subscription = liveSubscription.get();
                            if (subscription != null) {
                                subscription.dispose();
                            }
                        });

        Mono<Void> send = session.send(outbound);

        Mono<Void> receive = session.receive()
                .map(WebSocketMessage::getPayloadAsText)
                .doOnNext(payload -> {
                    if (payload != null && payload.contains("reset")) {
                        broadcaster.reset();
                    }
                })
                .then();

        return Mono.zip(send, receive).then();
    }
}
