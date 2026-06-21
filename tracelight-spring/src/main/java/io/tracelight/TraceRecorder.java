package io.tracelight;

/** Records a hit on a named point. Implemented by {@link DefaultTraceRecorder}. */
public interface TraceRecorder {
    void hit(String name);
}
