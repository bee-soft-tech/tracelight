package io.beesofttech.tracelight;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/** Small REST surface for the UI: a button to reset counters. */
@RestController
public class TracelightController {

    private final TracelightBroadcaster broadcaster;

    public TracelightController(TracelightBroadcaster broadcaster) {
        this.broadcaster = broadcaster;
    }

    @PostMapping("${tracelight.base-path:/tracelight}/reset")
    public void reset() {
        broadcaster.reset();
    }
}
