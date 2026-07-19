package io.beesofttech.tracelight;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class TraceContextTest {

    @AfterEach
    void tearDown() {
        TraceContext.clear();
    }

    @Test
    void setBindsAnExistingContextToTheCurrentThread() {
        TraceContext ctx = TraceContext.start("GET /a");
        String traceId = ctx.traceId();
        TraceContext.clear();
        assertThat(TraceContext.current()).isNull();

        TraceContext.set(ctx);

        assertThat(TraceContext.current()).isSameAs(ctx);
        assertThat(TraceContext.current().traceId()).isEqualTo(traceId);
    }

    @Test
    void setNullClearsTheCurrentThread() {
        TraceContext.start("GET /a");
        TraceContext.set(null);
        assertThat(TraceContext.current()).isNull();
    }
}
