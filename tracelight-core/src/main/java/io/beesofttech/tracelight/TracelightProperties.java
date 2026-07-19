package io.beesofttech.tracelight;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Configuration under the {@code tracelight.*} prefix. */
@ConfigurationProperties(prefix = "tracelight")
public class TracelightProperties {

    /** Master switch. Set {@code tracelight.enabled=false} to disable entirely. */
    private boolean enabled = true;

    /** Base path for Tracelight endpoints. The WebSocket lives at {@code basePath + "/ws"}. */
    private String basePath = "/tracelight";

    /**
     * How often (ms) to flush aggregated hit events to clients. With a positive value,
     * hits are coalesced over the window and sent as one {@code batch} event — essential
     * under heavy traffic. Set to {@code 0} to send one {@code pulse} event per hit.
     */
    private long flushIntervalMs = 100;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getBasePath() {
        return basePath;
    }

    public void setBasePath(String basePath) {
        this.basePath = basePath;
    }

    public long getFlushIntervalMs() {
        return flushIntervalMs;
    }

    public void setFlushIntervalMs(long flushIntervalMs) {
        this.flushIntervalMs = flushIntervalMs;
    }
}
