package io.tracelight;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers the Tracelight WebSocket handler at {@code basePath + "/ws"}.
 *
 * <p>Kept separate from {@link TracelightAutoConfiguration} so the broadcaster bean
 * is fully built before this configuration (which depends on it) is constructed.
 */
@Configuration(proxyBeanMethods = false)
@EnableWebSocket
public class TracelightWebSocketConfig implements WebSocketConfigurer {

    private final TracelightProperties properties;
    private final TracelightWebSocketHandler handler;

    public TracelightWebSocketConfig(TracelightProperties properties, TracelightBroadcaster broadcaster) {
        this.properties = properties;
        this.handler = new TracelightWebSocketHandler(broadcaster);
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, properties.getBasePath() + "/ws")
                .setAllowedOriginPatterns("*");
    }
}
