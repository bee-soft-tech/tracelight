import { useEffect, useMemo, useRef, useState } from 'react';
import type { RouteInfo } from 'tracelight-react';

interface RouteSelectProps {
  routes: RouteInfo[];
  /** Selected entry id, or null before any route has been discovered. */
  value: string | null;
  onChange: (value: string) => void;
  /** Lock the picker (e.g. while reviewing a single request, whose route is fixed). */
  disabled?: boolean;
}

/**
 * Searchable route picker. Exactly one route is shown at a time; typing filters the discovered
 * routes by path, and each item shows how many requests have hit that route. Until the first
 * route arrives the control is empty and disabled.
 */
export function RouteSelect({ routes, value, onChange, disabled = false }: RouteSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // While locked (review mode), never stay open.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const selectedLabel =
    value == null ? 'No routes yet' : (routes.find((r) => r.id === value)?.label ?? value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? routes.filter((r) => r.label.toLowerCase().includes(q)) : routes;
  }, [routes, query]);

  // Close on outside click / Escape; focus the search box when opening.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="route-select" ref={rootRef}>
      <button
        type="button"
        className="route-select__button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || routes.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={disabled ? 'Route is locked while reviewing a request' : 'Choose a route'}
      >
        <span className="route-select__value">{selectedLabel}</span>
        <span className="route-select__caret">▾</span>
      </button>

      {open && (
        <div className="route-select__pop">
          <input
            ref={inputRef}
            className="route-select__search"
            placeholder="Filter routes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
          <ul className="route-select__list" role="listbox">
            {filtered.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={`route-select__item ${value === r.id ? 'is-active' : ''}`}
                  onClick={() => pick(r.id)}
                >
                  <span className="route-select__label">{r.label}</span>
                  <span className="route-select__count">{r.count}</span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="route-select__empty">No matching routes</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
