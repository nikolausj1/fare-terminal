'use client';

import { useId, useState, type ReactNode } from 'react';

import { cn } from '@/lib/format';

/** Accessible expand/collapse: native <button aria-expanded> + a chevron,
 * content hidden with `hidden` (not just visually) when collapsed so it's
 * removed from the accessibility tree and tab order. */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className={cn('border-t border-[var(--border)] pt-3', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)]"
      >
        <span>{summary}</span>
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
    </div>
  );
}
