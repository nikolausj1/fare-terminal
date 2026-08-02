'use client';

// Count-up-on-first-paint number for the Index hero and card prices (WP-F3
// motion inventory). Renders `value` formatted normally on the server (SSR)
// and on the client's first paint (identical, to avoid a hydration
// mismatch), then animates from 0 -> value with requestAnimationFrame right
// after mount. Skips the animation entirely when the user prefers reduced
// motion — this is a JS-driven rAF loop, not a CSS animation/transition, so
// it can't rely on globals.css's blanket
// `@media (prefers-reduced-motion: reduce)` duration override and checks
// matchMedia itself.
//
// `format` is a plain serializable descriptor, NOT a function: this
// component is rendered from server components (MarketCard, IndexHero), and
// a function prop can't cross the server/client boundary (React Server
// Components can only pass serializable props to Client Components).

import { useEffect, useRef, useState } from 'react';

import { formatPriceMinor } from '@/lib/format';

const DEFAULT_DURATION_MS = 900;

export type AnimatedNumberFormat = { kind: 'price'; currency?: string } | { kind: 'decimal'; digits?: number };

function renderValue(v: number, format: AnimatedNumberFormat): string {
  if (format.kind === 'price') return formatPriceMinor(Math.round(v), format.currency);
  return v.toFixed(format.digits ?? 1);
}

export function AnimatedNumber({
  value,
  format,
  durationMs = DEFAULT_DURATION_MS,
  className,
}: {
  value: number;
  format: AnimatedNumberFormat;
  durationMs?: number;
  className?: string;
}) {
  // Initial render (server AND client, pre-hydration) shows the final value
  // — no flash of 0, no hydration mismatch. The count-up-from-0 only starts
  // once the mount effect below runs.
  const [display, setDisplay] = useState(value);
  const hasAnimatedRef = useRef(false);

  useEffect(() => {
    if (hasAnimatedRef.current) return;
    hasAnimatedRef.current = true;

    const reduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      // Initial state already rendered `value` (see the useState initializer
      // above) — nothing to animate, and nothing to set.
      return;
    }

    const target = value;
    let raf: number;
    const startTime = performance.now();

    // The first requestAnimationFrame callback runs with elapsed ~= 0, so
    // it naturally renders a value ~= 0 on its own — no separate
    // `setDisplay(0)` primer needed here (which would otherwise be a
    // synchronous setState call directly in the effect body).
    function tick(now: number) {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out-cubic
      setDisplay(target * eased);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      }
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Intentionally mount-only: this is a first-paint flourish, not a
    // value-change animator (card/index re-renders with a new `value` — e.g.
    // client-side navigation back to "/" — should just show the new number,
    // not re-run the count-up).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <span className={className}>{renderValue(display, format)}</span>;
}
