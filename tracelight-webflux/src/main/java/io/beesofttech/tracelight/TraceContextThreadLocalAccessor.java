package io.beesofttech.tracelight;

import io.micrometer.context.ThreadLocalAccessor;

/**
 * Bridges the {@link TraceContext} {@link ThreadLocal} to the Reactor Context so that, with
 * {@code Hooks.enableAutomaticContextPropagation()} enabled, the current request's context is
 * restored on whatever thread runs each reactive operator. Registered once in
 * {@link TracelightWebFluxAutoConfiguration}.
 */
public class TraceContextThreadLocalAccessor implements ThreadLocalAccessor<TraceContext> {

    /** Reactor-Context key under which the {@link WebFilter} stores the request's context. */
    public static final String KEY = "io.tracelight.trace";

    @Override
    public Object key() {
        return KEY;
    }

    @Override
    public TraceContext getValue() {
        return TraceContext.current();
    }

    @Override
    public void setValue(TraceContext value) {
        TraceContext.set(value);
    }

    @Override
    public void setValue() {
        TraceContext.clear();
    }
}
