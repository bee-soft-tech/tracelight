package io.beesofttech.tracelight;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.Signature;
import org.aspectj.lang.reflect.MethodSignature;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

class ReactiveTracePointAspectTest {

    /** Records hit/error calls in order. */
    static final class RecordingRecorder implements TraceRecorder {
        final List<String> hits = new ArrayList<>();
        final List<Throwable> errors = new ArrayList<>();
        @Override public void hit(String name) { hits.add(name); }
        @Override public void error(Throwable t) { errors.add(t); }
    }

    // Sample methods whose signatures/return types the advice inspects.
    Mono<String> monoMethod() { return Mono.just("ok"); }
    Flux<String> fluxMethod() { return Flux.just("a", "b"); }
    String syncMethod() { return "ok"; }

    private ProceedingJoinPoint jp(String methodName, Class<?> returnType, Object proceedResult,
                                   Throwable proceedThrows) throws Throwable {
        ProceedingJoinPoint pjp = Mockito.mock(ProceedingJoinPoint.class);
        MethodSignature sig = Mockito.mock(MethodSignature.class);
        Method m = getClass().getDeclaredMethod(methodName);
        Mockito.when(sig.getMethod()).thenReturn(m);
        Mockito.when(sig.getReturnType()).thenReturn((Class) returnType);
        Mockito.when(pjp.getSignature()).thenReturn((Signature) sig);
        if (proceedThrows != null) {
            Mockito.when(pjp.proceed()).thenThrow(proceedThrows);
        } else {
            Mockito.when(pjp.proceed()).thenReturn(proceedResult);
        }
        return pjp;
    }

    private TracePoint tracePoint(String value) {
        TracePoint tp = Mockito.mock(TracePoint.class);
        Mockito.when(tp.value()).thenReturn(value);
        return tp;
    }

    @Test
    void monoRecordsHitOnSubscribeNotAssembly() throws Throwable {
        RecordingRecorder rec = new RecordingRecorder();
        var aspect = new ReactiveTracePointAspect(rec);

        Object out = aspect.around(jp("monoMethod", Mono.class, Mono.just("ok"), null), tracePoint("m"));

        // Not yet subscribed -> no hit recorded.
        assertThat(rec.hits).isEmpty();
        StepVerifier.create((Mono<String>) out).expectNext("ok").verifyComplete();
        assertThat(rec.hits).containsExactly("m");
    }

    @Test
    void monoRecordsErrorOnErrorSignal() throws Throwable {
        RecordingRecorder rec = new RecordingRecorder();
        var aspect = new ReactiveTracePointAspect(rec);
        RuntimeException boom = new RuntimeException("boom");

        Object out = aspect.around(jp("monoMethod", Mono.class, Mono.error(boom), null), tracePoint("m"));

        StepVerifier.create((Mono<?>) out).expectErrorMatches(t -> t == boom).verify();
        assertThat(rec.errors).containsExactly(boom);
    }

    @Test
    void fluxRecordsHitOnSubscribe() throws Throwable {
        RecordingRecorder rec = new RecordingRecorder();
        var aspect = new ReactiveTracePointAspect(rec);

        Object out = aspect.around(jp("fluxMethod", Flux.class, Flux.just("a", "b"), null), tracePoint("f"));

        assertThat(rec.hits).isEmpty();
        StepVerifier.create((Flux<String>) out).expectNext("a", "b").verifyComplete();
        assertThat(rec.hits).containsExactly("f");
    }

    @Test
    void syncMethodRecordsHitBeforeProceed() throws Throwable {
        RecordingRecorder rec = new RecordingRecorder();
        var aspect = new ReactiveTracePointAspect(rec);

        Object out = aspect.around(jp("syncMethod", String.class, "ok", null), tracePoint("s"));

        assertThat(out).isEqualTo("ok");
        assertThat(rec.hits).containsExactly("s");
    }

    @Test
    void syncMethodRecordsErrorOnThrowAndRethrows() throws Throwable {
        RecordingRecorder rec = new RecordingRecorder();
        var aspect = new ReactiveTracePointAspect(rec);
        IllegalStateException boom = new IllegalStateException("no");

        assertThatThrownBy(() ->
                aspect.around(jp("syncMethod", String.class, null, boom), tracePoint("s")))
                .isSameAs(boom);
        assertThat(rec.errors).containsExactly(boom);
    }

    @Test
    void emptyAnnotationValueFallsBackToMethodName() throws Throwable {
        RecordingRecorder rec = new RecordingRecorder();
        var aspect = new ReactiveTracePointAspect(rec);

        Object out = aspect.around(jp("monoMethod", Mono.class, Mono.just("ok"), null), tracePoint(""));
        StepVerifier.create((Mono<String>) out).expectNext("ok").verifyComplete();
        assertThat(rec.hits).containsExactly("monoMethod");
    }
}
