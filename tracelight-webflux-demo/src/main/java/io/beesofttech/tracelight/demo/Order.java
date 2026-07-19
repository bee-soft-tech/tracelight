package io.beesofttech.tracelight.demo;

/** Demo order payload. */
public record Order(double amount, boolean premium, String country) {
}
