import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

export interface TLEdgeData {
  /** Non-null while the edge is flashing (a request just traversed it); keys the flash. */
  flashId: number | null;
  /** Flash fade-out duration, ms. */
  flashMs?: number;
  /** Cumulative traversal latency (ms) since the last reset; absent until timed. */
  min?: number;
  avg?: number;
  max?: number;
  samples?: number;
  /** When false, the timing label is hidden even if the edge has samples. Default shown. */
  showTimings?: boolean;
  [key: string]: unknown;
}

const DEFAULT_FLASH = 500;

/** Sub-millisecond precision below 10 ms, whole milliseconds above — keeps the label compact. */
function fmtMs(ms: number): string {
  return ms < 10 ? ms.toFixed(1) : Math.round(ms).toString();
}

/**
 * Purely presentational edge. When a request traverses A→B the parent ({@link TraceGraph})
 * marks this edge active; we render a coloured overlay over the base edge that fades out,
 * i.e. the connecting arrow blinks green. No local state ⇒ immune to React Flow remounts,
 * and only edges a request actually crossed light up.
 */
export function PulseEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd } = props;
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const data = props.data as TLEdgeData | undefined;
  const flashId = data?.flashId ?? null;
  const flashMs = data?.flashMs ?? DEFAULT_FLASH;
  const showTiming =
    data?.showTimings !== false &&
    data?.samples != null && data.samples > 0 &&
    data.min != null && data.avg != null && data.max != null;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className="tl-edge" />
      {flashId !== null && (
        <path key={flashId} d={path} className="tl-edge__flash" fill="none">
          <animate attributeName="opacity" from="1" to="0" dur={`${flashMs}ms`} fill="freeze" />
        </path>
      )}
      {showTiming && (
        <EdgeLabelRenderer>
          <div
            className="tl-edge__timing"
            style={{
              position: 'absolute',
              // Anchor the label's bottom just above the edge midpoint, with a small gap.
              transform: `translate(-50%, -100%) translate(${labelX}px, ${labelY - 4}px)`,
              pointerEvents: 'none',
            }}
          >
            {fmtMs(data.min!)} / {fmtMs(data.avg!)} / {fmtMs(data.max!)} ms
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
