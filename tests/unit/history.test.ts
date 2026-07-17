import { describe, expect, it } from 'vitest';
import { historicalPercentile } from '@/domain/history/percentile';
import { fairValueRange } from '@/domain/history/fairValue';
import { volatility } from '@/domain/history/volatility';
import { filterCompatibleSnapshots } from '@/domain/history/cohort';

describe('historicalPercentile', () => {
  it('returns 0 for an empty history', () => {
    expect(historicalPercentile(100, [])).toBe(0);
  });

  it('returns 100 when every historical value is higher than current (cheapest ever)', () => {
    expect(historicalPercentile(50, [100, 200, 300])).toBe(100);
  });

  it('returns 0 when no historical value is higher than current (priciest ever)', () => {
    expect(historicalPercentile(500, [100, 200, 300])).toBe(0);
  });

  it('does not count ties toward either side', () => {
    // 100 is tied, 200 and 300 are higher -> 2/4 = 50
    expect(historicalPercentile(100, [100, 200, 300, 50])).toBe(50);
  });

  it('computes a mid-range percentile correctly', () => {
    // history: 10 values, 3 are higher than 55 -> 30
    const history = [10, 20, 30, 40, 50, 60, 70, 80, 55, 55];
    expect(historicalPercentile(55, history)).toBe(30);
  });
});

describe('fairValueRange', () => {
  it('returns null when history has fewer than minHistoryForFairValue points', () => {
    const short = Array.from({ length: 14 }, (_, i) => 10000 + i * 10);
    expect(fairValueRange(short)).toBeNull();
  });

  it('returns a centered band once there is enough history', () => {
    const history = Array.from({ length: 15 }, () => 10000);
    const range = fairValueRange(history);
    expect(range).not.toBeNull();
    expect(range?.center).toBe(10000);
    expect(range?.low).toBe(10000);
    expect(range?.high).toBe(10000);
  });

  it('widens the band with dispersion in the history', () => {
    const flat = Array.from({ length: 20 }, () => 10000);
    // A genuinely spread-out distribution, not just 2 outliers buried in 18
    // flat values (MAD is robust enough that a small minority of outliers
    // doesn't move it at all).
    const dispersed = Array.from({ length: 20 }, (_, i) => 9000 + i * 100);
    const flatRange = fairValueRange(flat);
    const dispersedRange = fairValueRange(dispersed);
    expect(flatRange).not.toBeNull();
    expect(dispersedRange).not.toBeNull();
    const flatWidth = (flatRange!.high - flatRange!.low);
    const dispersedWidth = dispersedRange!.high - dispersedRange!.low;
    expect(dispersedWidth).toBeGreaterThan(flatWidth);
  });
});

describe('volatility', () => {
  it('returns 0 for fewer than 2 points', () => {
    expect(volatility([100])).toBe(0);
    expect(volatility([])).toBe(0);
  });

  it('returns 0 for a perfectly flat history', () => {
    expect(volatility([100, 100, 100, 100])).toBe(0);
  });

  it('returns a higher value for a more dispersed history', () => {
    const stable = [100, 101, 99, 100, 100];
    const volatile = [100, 150, 50, 120, 80];
    expect(volatility(volatile)).toBeGreaterThan(volatility(stable));
  });
});

describe('filterCompatibleSnapshots', () => {
  it('keeps only rows matching the given methodologyVersion', () => {
    const rows = [
      { id: 1, methodologyVersion: 'benchmark-v1' },
      { id: 2, methodologyVersion: 'benchmark-v2' },
      { id: 3, methodologyVersion: 'benchmark-v1' },
    ];
    const result = filterCompatibleSnapshots(rows, 'benchmark-v1');
    expect(result.map((r) => r.id)).toEqual([1, 3]);
  });

  it('returns an empty array when nothing matches', () => {
    const rows = [{ id: 1, methodologyVersion: 'benchmark-v1' }];
    expect(filterCompatibleSnapshots(rows, 'benchmark-v2')).toEqual([]);
  });
});
