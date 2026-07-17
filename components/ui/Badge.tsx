// Recommendation/confidence/severity chips. Color is NEVER the only signal
// — every variant pairs a color with a glyph and/or explicit text label.

import { cn } from '@/lib/format';
import type { ConfidenceLevel, RecommendationLabel } from '@/domain/types';

type Severity = 'LOW' | 'MEDIUM' | 'HIGH';

const RECOMMENDATION_STYLE: Record<RecommendationLabel, string> = {
  BUY: 'bg-[var(--pos-bg)] text-[var(--pos)] border-[var(--pos)]/40',
  LEAN_BUY: 'bg-[var(--pos-bg)] text-[var(--pos)] border-[var(--pos)]/30',
  NEUTRAL: 'bg-white/5 text-[var(--text-secondary)] border-[var(--border-strong)]',
  WAIT: 'bg-[var(--warn-bg)] text-[var(--warn)] border-[var(--warn)]/40',
  INSUFFICIENT_DATA:
    'bg-transparent text-[var(--text-tertiary)] border-dashed border-[var(--border-strong)]',
};

const RECOMMENDATION_LABEL: Record<RecommendationLabel, string> = {
  BUY: 'Buy',
  LEAN_BUY: 'Lean buy',
  NEUTRAL: 'Neutral',
  WAIT: 'Wait',
  INSUFFICIENT_DATA: 'Insufficient data',
};

export function RecommendationBadge({ label, className }: { label: RecommendationLabel; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold',
        RECOMMENDATION_STYLE[label],
        className
      )}
    >
      {RECOMMENDATION_LABEL[label]}
    </span>
  );
}

const CONFIDENCE_STYLE: Record<ConfidenceLevel, string> = {
  HIGH: 'bg-[var(--accent-bg)] text-[var(--accent)] border-[var(--accent)]/40',
  MODERATE: 'bg-white/5 text-[var(--text-secondary)] border-[var(--border-strong)]',
  LOW: 'bg-transparent text-[var(--text-tertiary)] border-[var(--border)]',
};

export function ConfidenceChip({ level, className }: { level: ConfidenceLevel; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums',
        CONFIDENCE_STYLE[level],
        className
      )}
    >
      {level === 'HIGH' ? 'High' : level === 'MODERATE' ? 'Moderate' : 'Low'} confidence
    </span>
  );
}

const SEVERITY_STYLE: Record<Severity, string> = {
  HIGH: 'bg-[var(--neg-bg)] text-[var(--neg)] border-[var(--neg)]/40',
  MEDIUM: 'bg-[var(--warn-bg)] text-[var(--warn)] border-[var(--warn)]/40',
  LOW: 'bg-white/5 text-[var(--text-secondary)] border-[var(--border-strong)]',
};

const SEVERITY_GLYPH: Record<Severity, string> = {
  HIGH: '!!',
  MEDIUM: '!',
  LOW: '·',
};

export function SeverityChip({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        SEVERITY_STYLE[severity],
        className
      )}
    >
      <span aria-hidden="true">{SEVERITY_GLYPH[severity]}</span>
      {severity[0]}
      {severity.slice(1).toLowerCase()}
    </span>
  );
}

export function DataQualityChip({ label, className }: { label: 'HIGH' | 'MEDIUM' | 'LOW'; className?: string }) {
  const style =
    label === 'HIGH'
      ? 'bg-[var(--pos-bg)] text-[var(--pos)] border-[var(--pos)]/30'
      : label === 'MEDIUM'
        ? 'bg-[var(--warn-bg)] text-[var(--warn)] border-[var(--warn)]/30'
        : 'bg-white/5 text-[var(--text-tertiary)] border-[var(--border)]';
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', style, className)}>
      Data quality: {label[0]}
      {label.slice(1).toLowerCase()}
    </span>
  );
}
