import { afterEach, describe, expect, it } from 'vitest';

import { getNow } from '@/lib/demo-time';

describe('getNow', () => {
  const original = process.env.DEMO_NOW;

  afterEach(() => {
    if (original === undefined) delete process.env.DEMO_NOW;
    else process.env.DEMO_NOW = original;
  });

  it('returns Date.parse(DEMO_NOW) when set', () => {
    process.env.DEMO_NOW = '2026-07-17T12:00:00.000Z';
    expect(getNow()).toBe(Date.parse('2026-07-17T12:00:00.000Z'));
  });

  it('falls back to the real clock when DEMO_NOW is unset', () => {
    delete process.env.DEMO_NOW;
    const before = Date.now();
    const now = getNow();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it('falls back to the real clock when DEMO_NOW is unparseable', () => {
    process.env.DEMO_NOW = 'not-a-date';
    const before = Date.now();
    const now = getNow();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});
