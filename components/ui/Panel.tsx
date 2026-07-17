import type { ReactNode } from 'react';

import { cn } from '@/lib/format';

export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
  as: Tag = 'section',
  titleId,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div';
  titleId?: string;
}) {
  return (
    <Tag
      className={cn(
        'rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5',
        className
      )}
      aria-labelledby={title ? titleId : undefined}
    >
      {(title || action) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && (
              <h2 id={titleId} className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-0.5 text-sm text-[var(--text-tertiary)]">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </Tag>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-dashed border-[var(--border)] px-3 py-6 text-center text-sm text-[var(--text-tertiary)]">
      {message}
    </p>
  );
}
