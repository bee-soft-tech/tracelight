package io.beesofttech.tracelight;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/** Small reactive REST surface for the UI: a button to reset counters. */
@RestController
public class TracelightReactiveController {

    private final TracelightBroadcaster broadcaster;

    public TracelightReactiveController(TracelightBroadcaster broadcaster) {
        this.broadcaster = broadcaster;
    }

    @PostMapping("${tracelight.base-path:/tracelight}/reset")
    public Mono<Void> reset() {
        return Mono.fromRunnable(broadcaster::reset);
    }
}
