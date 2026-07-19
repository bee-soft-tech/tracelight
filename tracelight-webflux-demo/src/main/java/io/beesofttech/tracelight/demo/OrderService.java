package io.beesofttech.tracelight.demo;

import io.beesofttech.tracelight.TracePoint;
import io.beesofttech.tracelight.Tracelight;
import java.time.Duration;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * Reactive demo business logic. Each method is a {@link TracePoint} (a graph node); the branches
 * inside use {@link Tracelight#hit(String)}. A {@code publishOn} hop is included deliberately so
 * the graph is only correct if the {@link io.tracelight.TraceContext} propagates across threads.
 */
@Service
public class OrderService {

    @TracePoint("validate")
    public Mono<Boolean> validate(Order order) {
        return Mono.fromSupplier(() -> {
            if (order.amount() <= 0) {
                Tracelight.hit("invalid-amount");
                return false;
            }
            Tracelight.hit("valid");
            return true;
        }).publishOn(Schedulers.parallel());
    }

    @TracePoint("inventory")
    public Mono<Void> checkInventory(Order order) {
        return Mono.<Void>fromRunnable(() -> {
            if (order.amount() < 50) {
                Tracelight.hit("in-stock");
            } else {
                Tracelight.hit("backorder");
            }
        }).delayElement(randomWork()).then();
    }

    @TracePoint("payment")
    public Mono<Void> charge(Order order) {
        return Mono.<Void>fromRunnable(() -> {
            if (order.premium()) {
                Tracelight.hit("premium-discount");
            } else {
                Tracelight.hit("standard-price");
            }
            if (order.amount() > 1000) {
                Tracelight.hit("fraud-check");
                if (order.amount() > 1900) {
                    throw new IllegalStateException(
                            "Payment gateway declined charge of " + order.amount() + " (limit 1900)");
                }
            }
        }).publishOn(Schedulers.parallel()).delayElement(randomWork()).then();
    }

    @TracePoint("ship")
    public Mono<Void> ship(Order order) {
        return Mono.<Void>fromRunnable(() -> {
            String country = order.country() == null ? "" : order.country().toUpperCase();
            switch (country) {
                case "PL", "DE", "FR" -> Tracelight.hit("ship-eu");
                case "US" -> Tracelight.hit("ship-us");
                default -> Tracelight.hit("ship-intl");
            }
        });
    }

    private static Duration randomWork() {
        return Duration.ofMillis(ThreadLocalRandom.current().nextInt(5, 35));
    }
}
