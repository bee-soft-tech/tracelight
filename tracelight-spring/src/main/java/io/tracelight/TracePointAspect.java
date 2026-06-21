package io.tracelight;

import org.aspectj.lang.JoinPoint;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Before;
import org.aspectj.lang.reflect.MethodSignature;

/** Turns {@link TracePoint}-annotated method calls into {@link TraceRecorder#hit(String)} calls. */
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
}
