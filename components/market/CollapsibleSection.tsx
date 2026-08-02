'use client';

import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';

import { cn } from '@/lib/format';

const MOBILE_QUERY = '(max-width: 767px)';

function subscribeToMobileQuery(callback: () => void): () => void {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getIsMobileSnapshot(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

// There's no viewport on the server, and useSyncExternalStore requires a
// fixed server snapshot (not "unknown") — default to desktop, matching the
// server-rendered "open" markup this hydrates against.
function getIsMobileServerSnapshot(): boolean {
  return false;
}

/** Like components/ui/Disclosure, but its default open/closed state is
 * viewport-driven instead of a static prop: open on desktop, collapsed on
 * mobile (WP-F4 §5 — "Offers table and Event timeline behind Disclosures,
 * open on desktop"). Reads the viewport via useSyncExternalStore (not an
 * effect + setState — React's purity rules flag synchronous setState in an
 * effect body as a footgun; useSyncExternalStore is the sanctioned way to
 * read external, changeable browser state during render) so the SSR pass
 * and first client render both correctly show "open," then react to the
 * real viewport immediately after hydration — and to a live resize, as a
 * bonus. A user's explicit toggle always wins over the viewport default
 * afterward. */
export function CollapsibleSection({
  title,
  titleId,
  children,
  className,
  id,
}: {
  title: string;
  titleId: string;
  children: ReactNode;
  className?: string;
  /** Anchor target id for the in-page section nav (SectionNav.tsx) — kept
   * separate from `titleId` since the nav's scroll targets are the section
   * wrappers, not the heading elements. */
  id?: string;
}) {
  const isMobile = useSyncExternalStore(subscribeToMobileQuery, getIsMobileSnapshot, getIsMobileServerSnapshot);
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? !isMobile;
  const panelId = useId();

  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cn('scroll-mt-24 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5', className)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setManualOpen(!open)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <h2 id={titleId} className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          {title}
        </h2>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className={cn('h-4 w-4 shrink-0 text-[var(--text-secondary)] transition-transform', open && 'rotate-180')}
          fill="none"
        >
          <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div id={panelId} hidden={!open} className="mt-3">
        {children}
      </div>
    </section>
  );
}
