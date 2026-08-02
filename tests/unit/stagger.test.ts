import { describe, expect, it } from 'vitest';

import { currentSweepBucket, hashStringToInt, isInSweepBucket } from '@/jobs/stagger';

describe('currentSweepBucket', () => {
  it('maps UTC hour 0 to bucket 0 with 4 buckets (6h-wide slices)', () => {
    expect(currentSweepBucket(Date.parse('2026-08-02T00:00:00Z'), 4)).toBe(0);
  });

  it('maps UTC hour 6 to bucket 1', () => {
    expect(currentSweepBucket(Date.parse('2026-08-02T06:00:00Z'), 4)).toBe(1);
  });

  it('maps UTC hour 12 to bucket 2', () => {
    expect(currentSweepBucket(Date.parse('2026-08-02T12:00:00Z'), 4)).toBe(2);
  });

  it('maps UTC hour 18 to bucket 3', () => {
    expect(currentSweepBucket(Date.parse('2026-08-02T18:00:00Z'), 4)).toBe(3);
  });

  it('maps an off-cadence hour (e.g. a manual workflow_dispatch at 14:00 UTC) to a valid bucket', () => {
    const bucket = currentSweepBucket(Date.parse('2026-08-02T14:30:00Z'), 4);
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(4);
    expect(bucket).toBe(2); // 14:xx still falls in the 12-18 slice
  });

  it('throws on a non-positive bucketCount', () => {
    expect(() => currentSweepBucket(Date.now(), 0)).toThrow();
  });
});

describe('isInSweepBucket', () => {
  it('assigns each item to exactly one of the 4 buckets across a full day', () => {
    const itemKey = 7;
    const hits = [0, 6, 12, 18].map((hour) =>
      isInSweepBucket(itemKey, 4, Date.parse(`2026-08-02T${String(hour).padStart(2, '0')}:00:00Z`))
    );
    expect(hits.filter(Boolean)).toHaveLength(1);
  });

  it('every item across a roster is covered exactly once over the 4 sweeps in a day', () => {
    const rosterIds = Array.from({ length: 26 }, (_, i) => i + 1); // ids 1..26, like search_definitions.id
    const covered = new Set<number>();
    for (const hour of [0, 6, 12, 18]) {
      const now = Date.parse(`2026-08-02T${String(hour).padStart(2, '0')}:00:00Z`);
      for (const id of rosterIds) {
        if (isInSweepBucket(id, 4, now)) covered.add(id);
      }
    }
    expect(covered.size).toBe(rosterIds.length);
  });

  it('normalizes negative item keys the same way as positive ones (no crash, still exactly one bucket match per day)', () => {
    const itemKey = -3;
    const hits = [0, 6, 12, 18].map((hour) =>
      isInSweepBucket(itemKey, 4, Date.parse(`2026-08-02T${String(hour).padStart(2, '0')}:00:00Z`))
    );
    expect(hits.filter(Boolean)).toHaveLength(1);
  });
});

describe('hashStringToInt', () => {
  it('is deterministic for the same input', () => {
    expect(hashStringToInt('JFK')).toBe(hashStringToInt('JFK'));
  });

  it('returns a non-negative integer', () => {
    const h = hashStringToInt('LAX');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
  });

  it('differs for different inputs (no trivial collisions across a small roster of origins)', () => {
    const origins = ['JFK', 'LAX', 'ORD', 'SFO', 'SEA', 'MIA', 'EWR', 'IAD', 'BOS', 'ATL', 'DFW'];
    const hashes = new Set(origins.map(hashStringToInt));
    expect(hashes.size).toBe(origins.length);
  });
});
