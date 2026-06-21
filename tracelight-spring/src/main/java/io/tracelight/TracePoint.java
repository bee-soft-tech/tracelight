package io.tracelight;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a method as a trace point. When the method is entered, a hit is recorded
 * under {@link #value()} (or the method name if empty).
 *
 * <pre>{@code
 * @TracePoint("validate-order")
 * public void validate(Order order) { ... }
 * }</pre>
 *
 * <p>Works on Spring-managed beans (applied via AOP). For branches inside a
 * method, use {@link Tracelight#hit(String)} instead.
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface TracePoint {
    String value() default "";
}
