// WP-F4 §4: unit coverage for the pure axis-position/zone math backing
// components/market/PercentileStrip.tsx.

import { describe, expect, it } from 'vitest';

import { clampPercentile, percentileMarkerLeftPct, percentileZone } from '@/components/market/percentileMath';

describe('clampPercentile', () => {
  it('passes through in-range values unchanged', () => {
    expect(clampPercentile(0)).toBe(0);
    expect(clampPercentile(50)).toBe(50);
    expect(clampPercentile(100)).toBe(100);
    expect(clampPercentile(86.4)).toBe(86.4);
  });

  it('clamps above 100 down to 100', () => {
    expect(clampPercentile(150)).toBe(100);
  });

  it('clamps below 0 up to 0', () => {
    expect(clampPercentile(-10)).toBe(0);
  });

  it('defaults non-finite input (NaN/Infinity) to 0 rather than propagating garbage', () => {
    expect(clampPercentile(NaN)).toBe(0);
    expect(clampPercentile(Infinity)).toBe(0);
    expect(clampPercentile(-Infinity)).toBe(0);
  });
});

describe('percentileMarkerLeftPct', () => {
  it('formats as a CSS percentage string', () => {
    expect(percentileMarkerLeftPct(86)).toBe('86.00%');
    expect(percentileMarkerLeftPct(0)).toBe('0.00%');
    expect(percentileMarkerLeftPct(100)).toBe('100.00%');
  });

  it('clamps before formatting', () => {
    expect(percentileMarkerLeftPct(150)).toBe('100.00%');
    expect(percentileMarkerLeftPct(-5)).toBe('0.00%');
  });
});

describe('percentileZone', () => {
  it('is "cheap" at and above the top quartile boundary (75)', () => {
    expect(percentileZone(75)).toBe('cheap');
    expect(percentileZone(100)).toBe('cheap');
    expect(percentileZone(86)).toBe('cheap');
  });

  it('is "expensive" at and below the bottom quartile boundary (25)', () => {
    expect(percentileZone(25)).toBe('expensive');
    expect(percentileZone(0)).toBe('expensive');
    expect(percentileZone(10)).toBe('expensive');
  });

  it('is "mid" strictly between the quartile boundaries', () => {
    expect(percentileZone(50)).toBe('mid');
    expect(percentileZone(26)).toBe('mid');
    expect(percentileZone(74)).toBe('mid');
  });

  it('clamps out-of-range input before zoning', () => {
    expect(percentileZone(200)).toBe('cheap');
    expect(percentileZone(-50)).toBe('expensive');
  });
});
