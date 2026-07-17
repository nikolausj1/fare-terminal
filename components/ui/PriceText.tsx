import { cn, formatPriceMinor } from '@/lib/format';

export function PriceText({
  minor,
  currency = 'USD',
  size = 'md',
  className,
}: {
  minor: number;
  currency?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const sizeClass = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-2xl',
    xl: 'text-4xl sm:text-5xl',
  }[size];
  return <span className={cn('num font-semibold text-[var(--text-primary)]', sizeClass, className)}>{formatPriceMinor(minor, currency)}</span>;
}
