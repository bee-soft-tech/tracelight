package io.tracelight;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.core.Ordered;

/**
 * Servlet adapter wiring: the {@link ServletMessageSink}, the core {@link TracelightBroadcaster}
 * and {@link TraceRecorder} (declared here so they sit alongside the sink they depend on), the
 * WebSocket endpoint, the request filter, the AOP aspect, and the reset controller. The
 * transport-agnostic {@link GraphRegistry} comes from {@link TracelightCoreAutoConfiguration}.
 */
@AutoConfiguration(after = TracelightCoreAutoConfiguration.class)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(prefix = "tracelight", name = "enabled", havingValue = "true", matchIfMissing = true)
@Import(TracelightWebSocketConfig.class)
public class TracelightAutoConfiguration {

    @Bean
    public ServletMessageSink tracelightMessageSink() {
        return new ServletMessageSink();
    }

    @Bean
    public TracelightBroadcaster tracelightBroadcaster(
            GraphRegistry registry, TracelightProperties properties, ServletMessageSink sink) {
        return new TracelightBroadcaster(registry, properties.getFlushIntervalMs(), sink);
    }

    @Bean
    public TraceRecorder tracelightRecorder(GraphRegistry registry, TracelightBroadcaster broadcaster) {
        DefaultTraceRecorder recorder = new DefaultTraceRecorder(registry, broadcaster);
        Tracelight.setRecorder(recorder);
        return recorder;
    }

    @Bean
    public TracePointAspect tracelightTracePointAspect(TraceRecorder recorder) {
        return new TracePointAspect(recorder);
    }

    @Bean
    public FilterRegistrationBean<TraceFilter> tracelightTraceFilter(
            GraphRegistry registry, TracelightBroadcaster broadcaster, TracelightProperties properties) {
        FilterRegistrationBean<TraceFilter> registration =
                new FilterRegistrationBean<>(new TraceFilter(registry, broadcaster, properties.getBasePath()));
        registration.addUrlPatterns("/*");
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE + 10);
        return registration;
    }

    @Bean
    public TracelightController tracelightController(TracelightBroadcaster broadcaster) {
        return new TracelightController(broadcaster);
    }
}
