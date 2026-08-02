// Subtle "this data is fresh" indicator (WP-F3 motion inventory): a small
// dot that pulses every 2s when shown. Purely decorative (aria-hidden) —
// the freshness fact itself is always also stated in visible text by the
// caller (e.g. "Updated 4m ago"), so this never carries information a
// screen-reader user would miss. The pulse keyframe + reduced-motion
// override live in app/globals.css (.pulse-dot-ring); no JS needed here, so
// the existing blanket `@media (prefers-reduced-motion: reduce)` rule
// already neutralizes it.

import { cn } from '@/lib/format';

/** Plain helper (NOT a component) — only Components/Hooks must stay pure
 * per React's rules, so a regular function is the correct place for a
 * Date.now() wall-clock comparison; calling it is fine from a component
 * body (react-hooks/purity flags impure calls written directly inside a
 * Component/Hook, not calls to a separately-defined regular function). */
export function isRecentlyUpdated(pastMs: number, windowMs: number): boolean {
  const ageMs = Date.now() - pastMs;
  return ageMs >= 0 && ageMs < windowMs;
}

export function PulseDot({ className }: { className?: string }) {
  return (
    <span className={cn('relative inline-flex h-2 w-2 shrink-0', className)} aria-hidden="true">
      <span className="pulse-dot-ring absolute inline-flex h-full w-full rounded-full bg-[var(--pos)]" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--pos)]" />
    </span>
  );
}
