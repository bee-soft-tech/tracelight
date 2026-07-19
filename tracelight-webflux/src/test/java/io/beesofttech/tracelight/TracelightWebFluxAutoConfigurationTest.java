package io.beesofttech.tracelight;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.test.context.runner.ReactiveWebApplicationContextRunner;
import org.springframework.web.reactive.handler.SimpleUrlHandlerMapping;

class TracelightWebFluxAutoConfigurationTest {

    @Test
    void reactiveContextWiresAllBeans() {
        new ReactiveWebApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(
                        TracelightCoreAutoConfiguration.class,
                        TracelightWebFluxAutoConfiguration.class))
                .run(context -> {
                    assertThat(context).hasSingleBean(GraphRegistry.class);
                    assertThat(context).hasSingleBean(ReactiveMessageSink.class);
                    assertThat(context).hasSingleBean(TracelightBroadcaster.class);
                    assertThat(context).hasSingleBean(TraceRecorder.class);
                    assertThat(context).hasSingleBean(ReactiveTracePointAspect.class);
                    assertThat(context).hasSingleBean(TracelightWebFilter.class);
                    assertThat(context).hasSingleBean(TracelightReactiveWebSocketHandler.class);
                    assertThat(context).hasSingleBean(TracelightReactiveController.class);
                    assertThat(context).hasBean("tracelightWebSocketMapping");
                    assertThat(context.getBean("tracelightWebSocketMapping"))
                            .isInstanceOf(SimpleUrlHandlerMapping.class);
                });
    }

    @Test
    void nonReactiveContextDoesNotActivate() {
        new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(
                        TracelightCoreAutoConfiguration.class,
                        TracelightWebFluxAutoConfiguration.class))
                .run(context -> assertThat(context).doesNotHaveBean(ReactiveMessageSink.class));
    }

    @Test
    void disabledPropertyDeactivates() {
        new ReactiveWebApplicationContextRunner()
                .withPropertyValues("tracelight.enabled=false")
                .withConfiguration(AutoConfigurations.of(
                        TracelightCoreAutoConfiguration.class,
                        TracelightWebFluxAutoConfiguration.class))
                .run(context -> assertThat(context).doesNotHaveBean(ReactiveMessageSink.class));
    }
}
