package io.tracelight.demo;

import io.tracelight.TracePoint;
import io.tracelight.Tracelight;
import org.springframework.stereotype.Service;

import java.util.concurrent.ThreadLocalRandom;

/**
 * Demo business logic. Each method is a {@link TracePoint} (a graph node); the
 * branches inside use {@link Tracelight#hit(String)} so every {@code if}/{@code switch}
 * shows up as its own node and edge.
 */
@Service
public class OrderService {

    @TracePoint("validate")
    public boolean validate(Order order) {
        if (order.amount() <= 0) {
            Tracelight.hit("invalid-amount");
            return false;
        }
        Tracelight.hit("valid");
        return true;
    }

    @TracePoint("inventory")
    public void checkInventory(Order order) {
        if (order.amount() < 50) {
            Tracelight.hit("in-stock");
        } else {
            Tracelight.hit("backorder");
        }
        work();
    }

    @TracePoint("payment")
    public void charge(Order order) {
        if (order.premium()) {
            Tracelight.hit("premium-discount");
        } else {
            Tracelight.hit("standard-price");
        }
        if (order.amount() > 1000) {
            Tracelight.hit("fraud-check");
        }
        work();
    }

    @TracePoint("ship")
    public void ship(Order order) {
        String country = order.country() == null ? "" : order.country().toUpperCase();
        switch (country) {
            case "PL", "DE", "FR" -> Tracelight.hit("ship-eu");
            case "US" -> Tracelight.hit("ship-us");
            default -> Tracelight.hit("ship-intl");
        }
    }

    /** Small randomized delay so pulses are visible in real time. */
    private static void work() {
        try {
            Thread.sleep(ThreadLocalRandom.current().nextInt(5, 35));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
