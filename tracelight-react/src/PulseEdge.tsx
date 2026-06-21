import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

export interface TLEdgeData {
  /** Increments on every pulse traversing this edge; retriggers the flying dot. */
  pulseSeq: number;
  [key: string]: unknown;
}

/**
 * Edge that animates a dot from source to target on each pulse. The dot is keyed by
 * `pulseSeq`, so it remounts and replays its `<animateMotion>` once per pulse, then fades.
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
  const pulseSeq = (props.data as TLEdgeData | undefined)?.pulseSeq ?? 0;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className="tl-edge" />
      {pulseSeq > 0 && (
        <circle key={pulseSeq} className="tl-edge__dot" r={5} opacity={0}>
          <animateMotion dur="0.6s" path={path} fill="freeze" />
          <animate
            attributeName="opacity"
            dur="0.6s"
            values="1;1;0"
            keyTimes="0;0.85;1"
            fill="remove"
          />
        </circle>
      )}
    </>
  );
}
