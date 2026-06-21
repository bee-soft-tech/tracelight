package io.tracelight;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Configuration under the {@code tracelight.*} prefix. */
@ConfigurationProperties(prefix = "tracelight")
public class TracelightProperties {

    /** Master switch. Set {@code tracelight.enabled=false} to disable entirely. */
    private boolean enabled = true;

    /** Base path for Tracelight endpoints. The WebSocket lives at {@code basePath + "/ws"}. */
    private String basePath = "/tracelight";

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
}
