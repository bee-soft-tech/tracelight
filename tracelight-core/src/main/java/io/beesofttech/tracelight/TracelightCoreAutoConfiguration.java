package io.beesofttech.tracelight;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

/**
 * Transport-agnostic Tracelight wiring. Contributes the in-memory graph registry and the
 * configuration properties. The broadcaster and recorder beans are declared by each transport
 * adapter (servlet, webflux) alongside the adapter's {@link MessageSink}, so the bean that needs
 * the transport is wired in the same place that provides it — avoiding cross-module
 * {@code @ConditionalOnBean} ordering issues and letting core start cleanly on its own.
 */
@AutoConfiguration
@ConditionalOnProperty(prefix = "tracelight", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(TracelightProperties.class)
public class TracelightCoreAutoConfiguration {

    @Bean
    public GraphRegistry tracelightGraphRegistry() {
        return new GraphRegistry();
    }
}
