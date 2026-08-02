// WP-F1 fix 4: formatRelativeTime used to concatenate an absolute date with
// "ago" for timestamps 30+ days in the past (e.g. "2026-07-01 ago") because
// the `${label} ago` wrapping applied unconditionally even after `label`
// had already become an ISO date string. These tests pin the exact boundary
// (day 29 vs day 30) and confirm the 30+ day path never gets an "ago"/"in "
// suffix, past or future.

import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from '@/lib/format';

const NOW = Date.parse('2026-07-31T00:00:00.000Z');
const DAY_MS = 86_400_000;

describe('formatRelativeTime', () => {
  it('renders "just now" under 45 seconds', () => {
    expect(formatRelativeTime(NOW - 10_000, NOW)).toBe('just now');
    expect(formatRelativeTime(NOW + 10_000, NOW)).toBe('just now');
  });

  it('renders minutes, then hours, then days for buckets under 30 days', () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5m ago');
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3h ago');
    expect(formatRelativeTime(NOW - 5 * DAY_MS, NOW)).toBe('5d ago');
    expect(formatRelativeTime(NOW + 5 * DAY_MS, NOW)).toBe('in 5d');
  });

  it('stays in the "Nd ago" bucket at 29 days', () => {
    expect(formatRelativeTime(NOW - 29 * DAY_MS, NOW)).toBe('29d ago');
  });

  it('switches to a bare absolute date at the 30-day boundary — no "ago" suffix', () => {
    const thirtyDaysAgo = NOW - 30 * DAY_MS;
    const result = formatRelativeTime(thirtyDaysAgo, NOW);
    expect(result).toBe(new Date(thirtyDaysAgo).toISOString().slice(0, 10));
    expect(result).not.toContain('ago');
  });

  it('renders old timestamps as a bare date, never "<date> ago" (the reported bug)', () => {
    const oldMs = Date.parse('2026-07-01T00:00:00.000Z');
    const result = formatRelativeTime(oldMs, NOW);
    expect(result).toBe('2026-07-01');
    expect(result).not.toMatch(/ago/);
  });

  it('future timestamps 30+ days out also get a bare date, no "in " prefix', () => {
    const farFuture = NOW + 60 * DAY_MS;
    const result = formatRelativeTime(farFuture, NOW);
    expect(result).toBe(new Date(farFuture).toISOString().slice(0, 10));
    expect(result.startsWith('in ')).toBe(false);
  });
});
