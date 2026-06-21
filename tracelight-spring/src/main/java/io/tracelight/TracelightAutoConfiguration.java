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
 * Auto-configuration that wires Tracelight into any servlet Spring Boot app on the
 * classpath. Adding the {@code tracelight-spring} dependency is enough; disable with
 * {@code tracelight.enabled=false}.
 */
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(prefix = "tracelight", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(TracelightProperties.class)
@Import(TracelightWebSocketConfig.class)
public class TracelightAutoConfiguration {

    @Bean
    public GraphRegistry tracelightGraphRegistry() {
        return new GraphRegistry();
    }

    @Bean
    public TracelightBroadcaster tracelightBroadcaster(GraphRegistry registry) {
        return new TracelightBroadcaster(registry);
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
