'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/format';
import type { LocationResult } from '@/lib/markets/queries';

interface AirportFieldProps {
  label: string;
  value: string;
  onChange: (raw: string) => void;
  onSelect: (result: LocationResult) => void;
  placeholder: string;
}

function AirportField({ label, value, onChange, onSelect, placeholder }: AirportFieldProps) {
  const [results, setResults] = useState<LocationResult[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputId = useId();
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = value.trim();
    // The empty-query case is cleared synchronously in the input's
    // onChange handler instead of here, so this effect never calls
    // setState directly in its body (only from the async fetch callback
    // below, which is fine).
    if (query.length === 0) {
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      fetch(`/api/search/locations?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : { results: [] }))
        .then((data: { results: LocationResult[] }) => {
          setResults(data.results ?? []);
          setActiveIndex(-1);
        })
        .catch(() => {
          /* aborted or network error — leave results as-is */
        });
    }, 150);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [value]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function choose(result: LocationResult) {
    onSelect(result);
    setOpen(false);
    setResults([]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && results[activeIndex]) {
        e.preventDefault();
        choose(results[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      <label htmlFor={inputId} className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          const next = e.target.value;
          onChange(next);
          setOpen(true);
          if (next.trim().length === 0) setResults([]);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--panel-raised)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)]"
      />
      {open && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-[var(--border-strong)] bg-[var(--panel-raised)] py-1 shadow-lg"
        >
          {results.map((r, i) => (
            <li
              key={r.iataCode}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(r);
              }}
              className={cn(
                'cursor-pointer px-3 py-2 text-sm',
                i === activeIndex ? 'bg-[var(--accent-bg)] text-[var(--accent)]' : 'text-[var(--text-primary)]'
              )}
            >
              <span className="num font-semibold">{r.iataCode}</span>{' '}
              <span className="text-[var(--text-secondary)]">
                {r.cityName} — {r.name}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SearchBox() {
  const router = useRouter();
  const [originText, setOriginText] = useState('');
  const [destText, setDestText] = useState('');
  const [originCode, setOriginCode] = useState<string | null>(null);
  const [destCode, setDestCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function swap() {
    setOriginText(destText);
    setDestText(originText);
    setOriginCode(destCode);
    setDestCode(originCode);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!originCode || !destCode) {
      setError('Choose an origin and destination from the suggestions.');
      return;
    }
    if (originCode === destCode) {
      setError('Origin and destination must be different.');
      return;
    }
    setError(null);
    router.push(`/market/${originCode.toLowerCase()}/${destCode.toLowerCase()}`);
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5">
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
        <AirportField
          label="From"
          value={originText}
          placeholder="City or airport code"
          onChange={(v) => {
            setOriginText(v);
            setOriginCode(null);
          }}
          onSelect={(r) => {
            setOriginText(`${r.cityName} (${r.iataCode})`);
            setOriginCode(r.iataCode);
          }}
        />
        <button
          type="button"
          onClick={swap}
          aria-label="Swap origin and destination"
          className="mb-0.5 shrink-0 self-center rounded-full border border-[var(--border-strong)] p-2 text-[var(--text-secondary)] hover:text-[var(--accent)] sm:self-end"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
            <path
              d="M6 3L3 6M3 6L6 9M3 6H17M14 17L17 14M17 14L14 11M17 14H3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <AirportField
          label="To"
          value={destText}
          placeholder="City or airport code"
          onChange={(v) => {
            setDestText(v);
            setDestCode(null);
          }}
          onSelect={(r) => {
            setDestText(`${r.cityName} (${r.iataCode})`);
            setDestCode(r.iataCode);
          }}
        />
        <button
          type="submit"
          className="shrink-0 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          View market
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--neg)]">
          {error}
        </p>
      )}
    </form>
  );
}
