import { useCallback, useEffect, useRef, useState } from 'react';
import { TraceRecorder } from './traceRecorder';
import type { TracelightState } from './useTracelight';
import type { RecordedTrace } from './types';

/** Keep at most this many captured requests (bounds memory on a long session). */
const MAX_TRACES = 200;

export interface TraceRecorderState {
  /** Whether a recording session is currently capturing requests. */
  recording: boolean;
  /** Requests captured in the current/last session, oldest first. */
  traces: RecordedTrace[];
  /** Begin a fresh recording session (clears previously captured traces). */
  startRecording: () => void;
  /** Stop capturing; keeps the captured traces for review. */
  stopRecording: () => void;
  /** Discard all captured traces. */
  clear: () => void;
}

/**
 * DVR-style session recorder. Subscribe it to the RAW (ungated) {@link TracelightState} so it
 * captures requests on every route. While recording, each completed request (immediate mode only —
 * it needs the per-request `open`/`pulse`/`close` frames) is appended to {@link traces} for later
 * slow-motion replay. Pure buffering lives in {@link TraceRecorder}; this hook only wires it to the
 * event stream and React state.
 */
export function useTraceRecorder(graph: TracelightState): TraceRecorderState {
  const { onPulse, onLifecycle } = graph;
  const [recording, setRecording] = useState(false);
  const [traces, setTraces] = useState<RecordedTrace[]>([]);
  const recorderRef = useRef(new TraceRecorder());
  const recordingRef = useRef(false);

  const startRecording = useCallback(() => {
    recorderRef.current = new TraceRecorder(); // fresh session
    setTraces([]);
    recordingRef.current = true;
    setRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    recordingRef.current = false;
    setRecording(false);
  }, []);

  const clear = useCallback(() => {
    recorderRef.current = new TraceRecorder();
    setTraces([]);
  }, []);

  useEffect(
    () =>
      onPulse((p) => {
        // traceId '-' is a batch aggregate (no request identity) — never recordable.
        if (!recordingRef.current || p.traceId === '-') return;
        recorderRef.current.pulse(p.traceId, p.from, p.to, p.ms, performance.now());
      }),
    [onPulse],
  );

  useEffect(
    () =>
      onLifecycle((e) => {
        if (!recordingRef.current) return;
        if (e.type === 'open') {
          recorderRef.current.open(e.traceId, e.entry, performance.now());
          return;
        }
        const trace = recorderRef.current.close(e.traceId, Date.now());
        if (trace) {
          setTraces((prev) => {
            const next = [...prev, trace];
            return next.length > MAX_TRACES ? next.slice(next.length - MAX_TRACES) : next;
          });
        }
      }),
    [onLifecycle],
  );

  return { recording, traces, startRecording, stopRecording, clear };
}
