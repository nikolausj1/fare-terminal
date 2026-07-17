import type { ReactNode } from 'react';

import { cn, formatSignedPct } from '@/lib/format';

export function StatBlock({
  label,
  value,
  size = 'md',
  delta,
  sublabel,
  className,
}: {
  label: string;
  value: ReactNode;
  size?: 'md' | 'xl';
  /** Percent change to render as a colored +/- delta with a directional glyph. */
  delta?: { pct: number | null; favorableWhen: 'down' | 'up' } | null;
  sublabel?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">{label}</span>
      <span className={cn('num font-semibold text-[var(--text-primary)]', size === 'xl' ? 'text-4xl' : 'text-xl')}>
        {value}
      </span>
      {delta !== undefined && delta !== null && delta.pct !== null && (
        <DeltaTag pct={delta.pct} favorableWhen={delta.favorableWhen} />
      )}
      {sublabel && <span className="text-xs text-[var(--text-tertiary)]">{sublabel}</span>}
    </div>
  );
}

/** A colored delta tag. `favorableWhen` controls whether a negative (down)
 * or positive (up) move renders green — for airfare, a price drop is
 * favorable ("down" = green), while e.g. offer count rising is favorable
 * ("up" = green). Always pairs color with a glyph and explicit sign. */
export function DeltaTag({
  pct,
  favorableWhen,
  className,
}: {
  pct: number;
  favorableWhen: 'down' | 'up';
  className?: string;
}) {
  const glyph = pct > 0 ? '▲' : pct < 0 ? '▼' : '—';
  const isFavorable = pct === 0 ? null : favorableWhen === 'down' ? pct < 0 : pct > 0;
  const colorVar = isFavorable === null ? '--text-secondary' : isFavorable ? '--pos' : '--neg';
  return (
    <span
      className={cn('num inline-flex items-center gap-1 text-sm font-medium', className)}
      style={{ color: `var(${colorVar})` }}
    >
      <span aria-hidden="true">{glyph}</span>
      {formatSignedPct(pct)}
    </span>
  );
}
