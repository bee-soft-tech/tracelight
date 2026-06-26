package io.tracelight;

/**
 * Static entry point for marking points in code.
 *
 * <pre>{@code
 * if (user.isPremium()) {
 *     Tracelight.hit("branch-premium");
 * } else {
 *     Tracelight.hit("branch-standard");
 * }
 * }</pre>
 *
 * <p>Works anywhere, including inside an {@code if}. No-op until the Spring
 * auto-configuration wires a {@link TraceRecorder} (so calls are safe in tests
 * or when Tracelight is disabled).
 */
public final class Tracelight {

    private static volatile TraceRecorder recorder;

    private Tracelight() {
    }

    /** Wired by the auto-configuration. */
    public static void setRecorder(TraceRecorder recorder) {
        Tracelight.recorder = recorder;
    }

    /** Records that the current request passed through the point {@code name}. */
    public static void hit(String name) {
        TraceRecorder r = recorder;
        if (r != null) {
            r.hit(name);
        }
    }

    /**
     * Records an exception thrown at the current point as a red error node on the graph.
     * Call it from a {@code catch} block; methods annotated with {@code @TracePoint} report
     * thrown exceptions automatically.
     */
    public static void error(Throwable t) {
        TraceRecorder r = recorder;
        if (r != null) {
            r.error(t);
        }
    }
}
