package io.beesofttech.tracelight;

import org.aspectj.lang.JoinPoint;
import org.aspectj.lang.annotation.AfterThrowing;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Before;
import org.aspectj.lang.reflect.MethodSignature;

/**
 * Turns {@link TracePoint}-annotated method calls into {@link TraceRecorder#hit(String)} calls,
 * and exceptions thrown out of them into {@link TraceRecorder#error(Throwable)} calls.
 */
@Aspect
public class TracePointAspect {

    private final TraceRecorder recorder;

    public TracePointAspect(TraceRecorder recorder) {
        this.recorder = recorder;
    }

    @Before("@annotation(tracePoint)")
    public void onTracePoint(JoinPoint joinPoint, TracePoint tracePoint) {
        String name = tracePoint.value();
        if (name == null || name.isEmpty()) {
            name = ((MethodSignature) joinPoint.getSignature()).getMethod().getName();
        }
        recorder.hit(name);
    }

    // Bind the annotation by parameter (like @Before) rather than a hardcoded fully-qualified
    // name, so a package rename can never silently break the pointcut again.
    @AfterThrowing(pointcut = "@annotation(tracePoint)", throwing = "ex")
    public void onTracePointThrows(TracePoint tracePoint, Throwable ex) {
        recorder.error(ex);
    }
}
