'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/lib/format';

/** WP-F4 §5: fixed six-section structure for every market page — Summary ·
 * Chart · Calendar · Events · Offers · Related — matching the anchor ids
 * set on each section's wrapper in
 * app/market/[origin]/[destination]/page.tsx. Kept as one shared constant
 * (rather than a prop) since every market page has exactly these sections
 * in this order; nothing about a given market changes the set. */
export const SECTION_NAV_ITEMS: { id: string; label: string }[] = [
  { id: 'section-summary', label: 'Summary' },
  { id: 'section-chart', label: 'Chart' },
  { id: 'section-calendar', label: 'Calendar' },
  { id: 'section-events', label: 'Events' },
  { id: 'section-offers', label: 'Offers' },
  { id: 'section-related', label: 'Related' },
];

/** Tracks which section's anchor target is nearest the top of the viewport
 * among those currently intersecting — a cheap "which section am I reading"
 * heuristic, purely for the nav's aria-current/highlight styling. Shared by
 * both the mobile chip row and the desktop tab strip. */
function useActiveSection(): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const targets = SECTION_NAV_ITEMS.map((item) => document.getElementById(item.id)).filter(
      (el): el is HTMLElement => el !== null
    );
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const top = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        setActiveId(top.target.id);
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: [0, 1] }
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, []);

  return activeId;
}

/** Mobile chip row: horizontally scrollable, sticky directly below
 * MarketHeader's compact price bar (top-11 matches that bar's h-11 fixed
 * height — see MarketHeader.tsx's `data-testid="sticky-summary"` div).
 * Rendered from within MarketHeader.tsx so it lands immediately after that
 * bar in DOM order, which is what makes the two independently-sticky
 * elements stack correctly instead of overlapping. */
export function SectionNavMobileChips() {
  const activeId = useActiveSection();

  return (
    <nav
      aria-label="Page sections"
      className="sticky top-11 z-10 -mx-4 overflow-x-auto border-b border-[var(--border)] bg-[var(--bg)]/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 md:hidden"
    >
      <ul className="flex w-max gap-2">
        {SECTION_NAV_ITEMS.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={activeId === item.id ? 'true' : undefined}
              className={cn(
                'block whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium',
                activeId === item.id
                  ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                  : 'border-[var(--border-strong)] text-[var(--text-secondary)]'
              )}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Desktop tab strip, sticky under the full header (rendered in page.tsx
 * right after <MarketHeader />, before the summary section) — desktop has
 * no compact sticky price bar to stack under, so this sticks to the
 * viewport top directly. */
export function SectionNavDesktopTabs() {
  const activeId = useActiveSection();

  return (
    <nav
      aria-label="Page sections"
      className="sticky top-0 z-10 hidden border-b border-[var(--border)] bg-[var(--bg)]/95 py-2 backdrop-blur md:flex"
    >
      <ul className="flex gap-1">
        {SECTION_NAV_ITEMS.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={activeId === item.id ? 'true' : undefined}
              className={cn(
                'block rounded-md px-3 py-1.5 text-sm font-medium',
                activeId === item.id
                  ? 'bg-[var(--accent-bg)] text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
