import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

export interface TLEdgeData {
  /** Non-null while the edge is flashing (a request just traversed it); keys the flash. */
  flashId: number | null;
  /** Flash fade-out duration, ms. */
  flashMs?: number;
  [key: string]: unknown;
}

const DEFAULT_FLASH = 500;

/**
 * Purely presentational edge. When a request traverses A→B the parent ({@link TraceGraph})
 * marks this edge active; we render a coloured overlay over the base edge that fades out,
 * i.e. the connecting arrow blinks green. No local state ⇒ immune to React Flow remounts,
 * and only edges a request actually crossed light up.
 */
export function PulseEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd } = props;
  const [path] = getBezierPath({
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

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className="tl-edge" />
      {flashId !== null && (
        <path key={flashId} d={path} className="tl-edge__flash" fill="none">
          <animate attributeName="opacity" from="1" to="0" dur={`${flashMs}ms`} fill="freeze" />
        </path>
      )}
    </>
  );
}
