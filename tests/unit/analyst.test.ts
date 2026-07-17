import { describe, expect, it } from 'vitest';
import { computeRecommendation } from '@/domain/recommendations/computeRecommendation';
import { buildAnalystPayload } from '@/domain/analyst/payload';
import { renderTemplateNote } from '@/domain/analyst/template';
import { validateNote } from '@/domain/analyst/validate';
import type { RecommendationLabel, SnapshotMetrics } from '@/domain/types';

const SNAPSHOT: SnapshotMetrics = {
  benchmarkPriceMinor: 30000,
  fromPriceMinor: 28000,
  medianPriceMinor: 30500,
  p25PriceMinor: 29000,
  validOfferCount: 12,
  uniqueItineraryCount: 9,
  carrierCount: 3,
  nonstopOfferCount: 5,
  oneStopOfferCount: 5,
  freshnessSeconds: 300,
  dataQualityScore: 0.9,
};

function payloadForLabel(label: RecommendationLabel) {
  const overrides: Record<RecommendationLabel, Parameters<typeof computeRecommendation>[0]> = {
    BUY: {
      percentile: 95,
      fairValue: { low: 27000, high: 31000, center: 29000 },
      currentBenchmark: 25000,
      momentum7dPct: 10,
      volatilityPct: 5,
      daysToDeparture: 2,
      offerCount: 12,
      offerCountChangePct: -30,
      dataQualityScore: 0.9,
      historyLength: 40,
      freshnessSeconds: 300,
    },
    LEAN_BUY: {
      percentile: 80,
      fairValue: { low: 27000, high: 31000, center: 29000 },
      currentBenchmark: 28000,
      momentum7dPct: 3,
      volatilityPct: 5,
      daysToDeparture: 10,
      offerCount: 12,
      offerCountChangePct: 0,
      dataQualityScore: 0.9,
      historyLength: 40,
      freshnessSeconds: 300,
    },
    NEUTRAL: {
      percentile: 50,
      fairValue: { low: 27000, high: 31000, center: 29000 },
      currentBenchmark: 30000,
      momentum7dPct: 0,
      volatilityPct: 5,
      daysToDeparture: 30,
      offerCount: 12,
      offerCountChangePct: 0,
      dataQualityScore: 0.9,
      historyLength: 40,
      freshnessSeconds: 300,
    },
    WAIT: {
      percentile: 5,
      fairValue: { low: 27000, high: 31000, center: 29000 },
      currentBenchmark: 33000,
      momentum7dPct: -10,
      volatilityPct: 0,
      daysToDeparture: 150,
      offerCount: 12,
      offerCountChangePct: 40,
      dataQualityScore: 0.9,
      historyLength: 40,
      freshnessSeconds: 300,
    },
    INSUFFICIENT_DATA: {
      percentile: null,
      fairValue: null,
      currentBenchmark: 30000,
      momentum7dPct: null,
      volatilityPct: null,
      daysToDeparture: null,
      offerCount: 3,
      offerCountChangePct: null,
      dataQualityScore: 0.1,
      historyLength: 1,
      freshnessSeconds: 100,
    },
  };

  const recommendation = computeRecommendation(overrides[label]);
  expect(recommendation.label).toBe(label);

  return buildAnalystPayload({
    searchDefinitionId: 1,
    snapshotAt: Date.parse('2026-07-17T12:00:00Z'),
    snapshot: SNAPSHOT,
    recommendation,
  });
}

const ALL_LABELS: RecommendationLabel[] = [
  'BUY',
  'LEAN_BUY',
  'NEUTRAL',
  'WAIT',
  'INSUFFICIENT_DATA',
];

describe('renderTemplateNote', () => {
  for (const label of ALL_LABELS) {
    it(`produces a valid, in-range, label-consistent note for ${label}`, () => {
      const payload = payloadForLabel(label);
      const note = renderTemplateNote(payload);

      const wordCount = note.trim().split(/\s+/).filter(Boolean).length;
      expect(wordCount).toBeGreaterThanOrEqual(60);
      expect(wordCount).toBeLessThanOrEqual(140);

      const validation = validateNote(note, payload);
      expect(validation.ok).toBe(true);
      expect(validation.violations).toEqual([]);
    });
  }

  it('is deterministic for the same payload', () => {
    const payload = payloadForLabel('BUY');
    expect(renderTemplateNote(payload)).toBe(renderTemplateNote(payload));
  });
});

describe('validateNote', () => {
  it('catches an invented number not present anywhere in the payload', () => {
    const payload = payloadForLabel('NEUTRAL');
    const validNote = renderTemplateNote(payload);
    const tamperedNote = `${validNote} Fares could jump 987654% next week.`;

    const result = validateNote(tamperedNote, payload);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes('987654'))).toBe(true);
  });

  it('catches a banned certainty phrase', () => {
    const payload = payloadForLabel('NEUTRAL');
    const note = `Prices are in a normal range, so there's no strong signal either way. This will definitely fall further. Confidence in this read is moderate.`.repeat(1);
    // pad to a plausible length isn't required for this check
    const result = validateNote(note, payload);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes('banned phrase'))).toBe(true);
  });

  it('catches a note that never states the recommendation label', () => {
    const payload = payloadForLabel('BUY');
    const note =
      'The market has shown some movement recently. Fares have changed a bit compared to before. It is unclear what this means for future pricing. Confidence in this read is moderate, and conditions may change.';
    const result = validateNote(note, payload);
    expect(result.ok).toBe(false);
    expect(
      result.violations.some((v) => v.includes('does not mention'))
    ).toBe(true);
  });

  it('accepts a note whose numbers are within tolerance of payload numbers', () => {
    const payload = payloadForLabel('BUY');
    // Payload's currentBenchmark is 25000; restate it with a tiny formatting
    // difference that should still be within the numeric tolerance.
    const note = `Current benchmark is 25000. Buy now: this looks like a good time to book. Confidence in this read is ${payload.recommendation.confidence.toLowerCase()}. ${FILLER_FOR_LENGTH}`;
    const result = validateNote(note, payload);
    expect(result.violations.filter((v) => v.includes('not traceable'))).toEqual([]);
  });
});

const FILLER_FOR_LENGTH =
  'This note reflects data observed at the time of analysis and covers the market conditions currently on record for this route, which may change as new fare data is recorded in subsequent runs.';

describe('buildAnalystPayload', () => {
  it('combines recommendation facts/inferences/limitations with extras', () => {
    const recommendation = computeRecommendation({
      percentile: 50,
      fairValue: null,
      currentBenchmark: 30000,
      momentum7dPct: 0,
      volatilityPct: 5,
      daysToDeparture: 30,
      offerCount: 12,
      offerCountChangePct: 0,
      dataQualityScore: 0.9,
      historyLength: 40,
      freshnessSeconds: 300,
    });

    const payload = buildAnalystPayload({
      searchDefinitionId: 7,
      snapshotAt: 123,
      snapshot: SNAPSHOT,
      recommendation,
      extraObservedFacts: ['A price drop event was detected 2 days ago.'],
      extraLimitations: ['Only one provider is currently integrated.'],
    });

    expect(payload.searchDefinitionId).toBe(7);
    expect(payload.observedFacts).toEqual([
      ...recommendation.observedFacts,
      'A price drop event was detected 2 days ago.',
    ]);
    expect(payload.limitations).toEqual([
      ...recommendation.limitations,
      'Only one provider is currently integrated.',
    ]);
  });
});
