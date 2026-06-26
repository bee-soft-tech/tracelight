package io.tracelight;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.core.Ordered;

/**
 * Servlet adapter wiring: contributes the {@link ServletMessageSink} consumed by the core
 * broadcaster, the WebSocket endpoint, the request filter, the AOP aspect, and the reset
 * controller. The transport-agnostic beans come from {@link TracelightCoreAutoConfiguration}.
 */
@AutoConfiguration(after = TracelightCoreAutoConfiguration.class)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(prefix = "tracelight", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(TracelightProperties.class)
@Import(TracelightWebSocketConfig.class)
public class TracelightAutoConfiguration {

    @Bean
    public ServletMessageSink tracelightMessageSink() {
        return new ServletMessageSink();
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
