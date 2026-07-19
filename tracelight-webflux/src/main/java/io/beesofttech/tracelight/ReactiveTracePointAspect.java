package io.beesofttech.tracelight;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Reactive counterpart of the servlet {@code TracePointAspect}. Unlike the synchronous aspect,
 * a {@code @TracePoint} method that returns a {@link Mono}/{@link Flux} only assembles a publisher
 * when called, so the hit must be recorded on subscription (real execution) and errors on the
 * reactive error signal. Non-reactive methods keep the synchronous semantics (hit before, error
 * on thrown exception).
 */
@Aspect
public class ReactiveTracePointAspect {

    private final TraceRecorder recorder;

    public ReactiveTracePointAspect(TraceRecorder recorder) {
        this.recorder = recorder;
    }

    @Around("@annotation(tracePoint)")
    public Object around(ProceedingJoinPoint joinPoint, TracePoint tracePoint) throws Throwable {
        MethodSignature signature = (MethodSignature) joinPoint.getSignature();
        String name = tracePoint.value();
        if (name == null || name.isEmpty()) {
            name = signature.getMethod().getName();
        }
        final String pointName = name;
        Class<?> returnType = signature.getReturnType();

        if (Mono.class.isAssignableFrom(returnType)) {
            Mono<?> mono = (Mono<?>) joinPoint.proceed();
            return mono.doFirst(() -> recorder.hit(pointName)).doOnError(recorder::error);
        }
        if (Flux.class.isAssignableFrom(returnType)) {
            Flux<?> flux = (Flux<?>) joinPoint.proceed();
            return flux.doFirst(() -> recorder.hit(pointName)).doOnError(recorder::error);
        }

        // Synchronous method: same semantics as the servlet @Before / @AfterThrowing aspect.
        recorder.hit(pointName);
        try {
            return joinPoint.proceed();
        } catch (Throwable t) {
            recorder.error(t);
            throw t;
        }
    }
}
