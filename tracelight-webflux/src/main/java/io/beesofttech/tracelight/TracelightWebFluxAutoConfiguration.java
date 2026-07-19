package io.beesofttech.tracelight;

import io.micrometer.context.ContextRegistry;
import java.util.Map;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.web.reactive.handler.SimpleUrlHandlerMapping;
import org.springframework.web.reactive.socket.WebSocketHandler;
import org.springframework.web.reactive.socket.server.support.WebSocketHandlerAdapter;
import reactor.core.publisher.Hooks;

/**
 * Reactive (WebFlux) adapter wiring: the {@link ReactiveMessageSink}, the core
 * {@link TracelightBroadcaster} and {@link TraceRecorder} (declared here alongside the sink they
 * depend on), the {@link TracelightWebFilter}, the {@code @Around} aspect, the reactive WebSocket
 * endpoint and its handler mapping/adapter, and the reset controller. On construction it registers
 * the {@link TraceContextThreadLocalAccessor} and turns on Reactor's automatic context propagation,
 * so the request's {@link TraceContext} survives thread hops and {@link Tracelight#hit(String)}
 * works unchanged. The transport-agnostic {@link GraphRegistry} comes from
 * {@link TracelightCoreAutoConfiguration}.
 */
@AutoConfiguration(after = TracelightCoreAutoConfiguration.class)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.REACTIVE)
@ConditionalOnProperty(prefix = "tracelight", name = "enabled", havingValue = "true", matchIfMissing = true)
public class TracelightWebFluxAutoConfiguration {

    public TracelightWebFluxAutoConfiguration() {
        // Bridge the TraceContext ThreadLocal into the Reactor Context and restore it across
        // operator thread hops. Both calls are global and idempotent.
        ContextRegistry.getInstance().registerThreadLocalAccessor(new TraceContextThreadLocalAccessor());
        Hooks.enableAutomaticContextPropagation();
    }

    @Bean
    public ReactiveMessageSink tracelightMessageSink() {
        return new ReactiveMessageSink();
    }

    @Bean
    public TracelightBroadcaster tracelightBroadcaster(
            GraphRegistry registry, TracelightProperties properties, ReactiveMessageSink sink) {
        return new TracelightBroadcaster(registry, properties.getFlushIntervalMs(), sink);
    }

    @Bean
    public TraceRecorder tracelightRecorder(GraphRegistry registry, TracelightBroadcaster broadcaster) {
        DefaultTraceRecorder recorder = new DefaultTraceRecorder(registry, broadcaster);
        Tracelight.setRecorder(recorder);
        return recorder;
    }

    @Bean
    public ReactiveTracePointAspect tracelightTracePointAspect(TraceRecorder recorder) {
        return new ReactiveTracePointAspect(recorder);
    }

    @Bean
    public TracelightWebFilter tracelightWebFilter(
            GraphRegistry registry, TracelightBroadcaster broadcaster, TracelightProperties properties) {
        return new TracelightWebFilter(registry, broadcaster, properties.getBasePath());
    }

    @Bean
    public TracelightReactiveWebSocketHandler tracelightReactiveWebSocketHandler(
            TracelightBroadcaster broadcaster, ReactiveMessageSink sink) {
        return new TracelightReactiveWebSocketHandler(broadcaster, sink);
    }

    @Bean
    public SimpleUrlHandlerMapping tracelightWebSocketMapping(
            TracelightProperties properties, TracelightReactiveWebSocketHandler handler) {
        Map<String, WebSocketHandler> map = Map.of(properties.getBasePath() + "/ws", handler);
        // High precedence so the WS path wins over annotated controllers.
        return new SimpleUrlHandlerMapping(map, Ordered.HIGHEST_PRECEDENCE + 10);
    }

    @Bean
    public WebSocketHandlerAdapter tracelightWebSocketHandlerAdapter() {
        return new WebSocketHandlerAdapter();
    }

    @Bean
    public TracelightReactiveController tracelightController(TracelightBroadcaster broadcaster) {
        return new TracelightReactiveController(broadcaster);
    }
}
