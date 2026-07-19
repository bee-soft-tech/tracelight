package io.beesofttech.tracelight;

import org.junit.jupiter.api.Test;
import org.springframework.aop.aspectj.annotation.AspectJProxyFactory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TracePointAspectTest {

    /** A {@code @TracePoint} method that throws — the aspect must turn the throw into an error node. */
    static class Thrower {
        @TracePoint("boom")
        public void explode() {
            throw new IllegalStateException("kaboom");
        }
    }

    @Test
    void afterThrowingRecordsAnErrorNodeForTracePointMethods() {
        GraphRegistry registry = new GraphRegistry();
        TracelightBroadcaster broadcaster = new TracelightBroadcaster(registry, 0, json -> { });
        DefaultTraceRecorder recorder = new DefaultTraceRecorder(registry, broadcaster);

        AspectJProxyFactory factory = new AspectJProxyFactory(new Thrower());
        factory.addAspect(new TracePointAspect(recorder));
        Thrower proxy = factory.getProxy();

        TraceContext.start(GraphRegistry.ENTRY_ID);
        try {
            assertThatThrownBy(proxy::explode).isInstanceOf(IllegalStateException.class);
        } finally {
            TraceContext.clear();
        }

        // @Before records the "boom" hit; @AfterThrowing must record the exception off it.
        GraphRegistry.NodeState err = registry.node("boom!IllegalStateException");
        assertThat(err).isNotNull();
        assertThat(err.kind()).isEqualTo("error");
        assertThat(err.count()).isEqualTo(1);
    }
}
