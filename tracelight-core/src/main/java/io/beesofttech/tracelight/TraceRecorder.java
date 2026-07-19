package io.beesofttech.tracelight;

/** Records a hit on a named point. Implemented by {@link DefaultTraceRecorder}. */
public interface TraceRecorder {
    void hit(String name);

    /** Records an exception thrown at the current point, as a red error node on the graph. */
    void error(Throwable t);
}
