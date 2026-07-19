import type { RecordedTrace } from '@tracelight/react';

interface ReviewBarProps {
  traces: RecordedTrace[];
  selected: number;
  onSelect: (index: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  speed: number;
  onSpeed: (rate: number) => void;
  onBackToLive: () => void;
}

const SPEEDS = [
  { label: '¼×', rate: 0.25 },
  { label: '½×', rate: 0.5 },
  { label: '1×', rate: 1 },
];

/**
 * DVR review controls: return to live, step through the captured requests, and play the selected
 * one back in slow motion. Shown only while in Review mode.
 */
export function ReviewBar({
  traces,
  selected,
  onSelect,
  playing,
  onTogglePlay,
  speed,
  onSpeed,
  onBackToLive,
}: ReviewBarProps) {
  const n = traces.length;
  const trace = traces[selected];

  return (
    <div className="reviewbar">
      <button className="reviewbar__live" onClick={onBackToLive} title="Return to live monitoring (Esc)">
        ↩ Back to live
      </button>

      <span className="reviewbar__group">
        <button
          onClick={() => onSelect(Math.max(0, selected - 1))}
          disabled={selected <= 0}
          aria-label="Previous request"
        >
          ◀
        </button>
        <span className="reviewbar__label">
          {n === 0 || !trace ? (
            'No requests captured'
          ) : (
            <>
              Request {selected + 1} / {n} — <code>{trace.entry}</code> · {trace.hops.length} hops ·{' '}
              {trace.totalMs.toFixed(1)} ms
            </>
          )}
        </span>
        <button
          onClick={() => onSelect(Math.min(n - 1, selected + 1))}
          disabled={selected >= n - 1}
          aria-label="Next request"
        >
          ▶
        </button>
      </span>

      <span className="reviewbar__speeds">
        {SPEEDS.map((s) => (
          <button
            key={s.rate}
            className={speed === s.rate ? 'is-active' : ''}
            onClick={() => onSpeed(s.rate)}
            title={`Replay at ${s.label}`}
          >
            {s.label}
          </button>
        ))}
      </span>

      <button className="reviewbar__play" onClick={onTogglePlay} disabled={!trace}>
        {playing ? '⏹ Stop' : '🐢 Play'}
      </button>
    </div>
  );
}
