package io.beesofttech.tracelight;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class TraceContextThreadLocalAccessorTest {

    private final TraceContextThreadLocalAccessor accessor = new TraceContextThreadLocalAccessor();

    @AfterEach
    void tearDown() {
        TraceContext.clear();
    }

    @Test
    void keyIsStable() {
        assertThat(accessor.key()).isEqualTo(TraceContextThreadLocalAccessor.KEY);
    }

    @Test
    void getValueReflectsTheThreadLocal() {
        assertThat(accessor.getValue()).isNull();
        TraceContext ctx = TraceContext.start("GET /a");
        assertThat(accessor.getValue()).isSameAs(ctx);
    }

    @Test
    void setValueRestoresAndClears() {
        TraceContext ctx = TraceContext.start("GET /a");
        TraceContext.clear();

        accessor.setValue(ctx);
        assertThat(TraceContext.current()).isSameAs(ctx);

        accessor.setValue(); // no-arg clear
        assertThat(TraceContext.current()).isNull();
    }
}
