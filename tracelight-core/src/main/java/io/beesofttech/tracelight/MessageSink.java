package io.beesofttech.tracelight;

/** Transport abstraction: send one JSON frame to all currently connected UI clients. */
public interface MessageSink {
    void broadcast(String json);
}
