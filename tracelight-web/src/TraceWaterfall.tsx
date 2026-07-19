import { waterfallLayout, type RecordedTrace } from 'tracelight-react';

/**
 * Zipkin-style timeline for one captured request: each hop is a bar starting where the previous
 * hops ended, its length proportional to the hop's latency. Untimed hops render as a thin marker.
 */
export function TraceWaterfall({ trace }: { trace: RecordedTrace }) {
  const { rows, totalMs } = waterfallLayout(trace);

  return (
    <div className="waterfall">
      <div className="waterfall__head">
        <code>{trace.entry}</code>
        <span className="muted">
          {trace.totalMs.toFixed(1)} ms total · {rows.length} hops
        </span>
      </div>
      <ol className="waterfall__rows">
        {rows.map((r, i) => (
          <li className="waterfall__row" key={i}>
            <span className="waterfall__label" title={`${r.from} → ${r.to}`}>
              {r.to}
            </span>
            <span className="waterfall__ms">{r.ms == null ? '—' : `${r.ms.toFixed(1)} ms`}</span>
            <span className="waterfall__track">
              <span
                className={`waterfall__bar ${r.ms == null ? 'waterfall__bar--unknown' : ''}`}
                style={{
                  left: `${(r.offsetMs / totalMs) * 100}%`,
                  width: `${Math.max((r.widthMs / totalMs) * 100, 0.4)}%`,
                }}
              />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
