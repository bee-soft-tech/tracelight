package io.tracelight;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

/**
 * Transport-agnostic Tracelight wiring: the graph registry, the broadcaster (which needs a
 * {@link MessageSink} supplied by a transport adapter), and the recorder. A servlet or webflux
 * adapter contributes the {@link MessageSink} and the request/WebSocket plumbing.
 */
@AutoConfiguration
@ConditionalOnProperty(prefix = "tracelight", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(TracelightProperties.class)
public class TracelightCoreAutoConfiguration {

    @Bean
    public GraphRegistry tracelightGraphRegistry() {
        return new GraphRegistry();
    }

    @Bean
    public TracelightBroadcaster tracelightBroadcaster(
            GraphRegistry registry, TracelightProperties properties, MessageSink sink) {
        return new TracelightBroadcaster(registry, properties.getFlushIntervalMs(), sink);
    }

    @Bean
    public TraceRecorder tracelightRecorder(GraphRegistry registry, TracelightBroadcaster broadcaster) {
        DefaultTraceRecorder recorder = new DefaultTraceRecorder(registry, broadcaster);
        Tracelight.setRecorder(recorder);
        return recorder;
    }
}
