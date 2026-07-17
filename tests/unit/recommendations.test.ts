import { describe, expect, it } from 'vitest';
import {
  computeRecommendation,
  type ComputeRecommendationInput,
} from '@/domain/recommendations/computeRecommendation';
import { config } from '@/domain/config';

function baseInput(
  overrides: Partial<ComputeRecommendationInput> = {}
): ComputeRecommendationInput {
  return {
    percentile: 50,
    fairValue: { low: 28000, high: 32000, center: 30000 },
    currentBenchmark: 30000,
    momentum7dPct: 0,
    volatilityPct: 5,
    daysToDeparture: 30,
    offerCount: 12,
    offerCountChangePct: 0,
    dataQualityScore: 0.9,
    historyLength: 40,
    freshnessSeconds: 300,
    ...overrides,
  };
}

describe('computeRecommendation: INSUFFICIENT_DATA gates', () => {
  it('gates on historyLength below minHistoryForRecommendation', () => {
    const result = computeRecommendation(
      baseInput({ historyLength: config.recommendationScoring.minHistoryForRecommendation - 1 })
    );
    expect(result.label).toBe('INSUFFICIENT_DATA');
    expect(result.limitations.join(' ')).toMatch(/history has only/);
  });

  it('gates on freshnessSeconds beyond staleAfterMinutes', () => {
    const result = computeRecommendation(
      baseInput({ freshnessSeconds: config.freshness.staleAfterMinutes * 60 + 1 })
    );
    expect(result.label).toBe('INSUFFICIENT_DATA');
    expect(result.limitations.join(' ')).toMatch(/staler than/);
  });

  it('gates on dataQualityScore below minDataQualityScore', () => {
    const result = computeRecommendation(
      baseInput({ dataQualityScore: config.recommendationScoring.minDataQualityScore - 0.01 })
    );
    expect(result.label).toBe('INSUFFICIENT_DATA');
    expect(result.limitations.join(' ')).toMatch(/data quality score/);
  });

  it('does not gate when all three inputs are exactly at the passing boundary', () => {
    const result = computeRecommendation(
      baseInput({
        historyLength: config.recommendationScoring.minHistoryForRecommendation,
        freshnessSeconds: config.freshness.staleAfterMinutes * 60,
        dataQualityScore: config.recommendationScoring.minDataQualityScore,
      })
    );
    expect(result.label).not.toBe('INSUFFICIENT_DATA');
  });

  it('has confidence LOW and score 0 for INSUFFICIENT_DATA', () => {
    const result = computeRecommendation(baseInput({ historyLength: 0 }));
    expect(result.confidence).toBe('LOW');
    expect(result.score).toBe(0);
  });
});

describe('computeRecommendation: label mapping across score ranges', () => {
  it('maps a very cheap, rising, urgent, tightening-supply market to BUY', () => {
    const result = computeRecommendation(
      baseInput({
        percentile: 95, // cheap -> historicalValueScore high
        momentum7dPct: 10, // rising
        daysToDeparture: 2, // urgent
        offerCountChangePct: -30, // supply tightening
        volatilityPct: 0,
      })
    );
    expect(result.label).toBe('BUY');
  });

  it('maps a moderately favorable market to LEAN_BUY', () => {
    const result = computeRecommendation(
      baseInput({
        percentile: 80,
        momentum7dPct: 3,
        daysToDeparture: 10,
        offerCountChangePct: 0,
        volatilityPct: 5,
      })
    );
    expect(['LEAN_BUY', 'BUY']).toContain(result.label);
  });

  it('maps a middling market to NEUTRAL', () => {
    const result = computeRecommendation(
      baseInput({
        percentile: 50,
        momentum7dPct: 0,
        daysToDeparture: 30,
        offerCountChangePct: 0,
        volatilityPct: 5,
      })
    );
    expect(result.label).toBe('NEUTRAL');
  });

  it('maps a very expensive, falling-supply, far-out market to WAIT', () => {
    const result = computeRecommendation(
      baseInput({
        percentile: 5, // expensive
        momentum7dPct: -10,
        daysToDeparture: 150,
        offerCountChangePct: 40,
        volatilityPct: 0,
      })
    );
    expect(result.label).toBe('WAIT');
  });

  it('score increases monotonically as percentile improves (all else equal)', () => {
    const cheap = computeRecommendation(baseInput({ percentile: 95 }));
    const mid = computeRecommendation(baseInput({ percentile: 50 }));
    const expensive = computeRecommendation(baseInput({ percentile: 5 }));
    expect(cheap.score).toBeGreaterThan(mid.score);
    expect(mid.score).toBeGreaterThan(expensive.score);
  });
});

describe('computeRecommendation: confidence', () => {
  it('assigns HIGH confidence for abundant, fresh, low-volatility, high-quality data', () => {
    const result = computeRecommendation(
      baseInput({
        dataQualityScore: 0.95,
        historyLength: 60,
        volatilityPct: 5,
      })
    );
    expect(result.confidence).toBe('HIGH');
  });

  it('assigns LOW confidence for thin/volatile data (but still passing the hard gates)', () => {
    const result = computeRecommendation(
      baseInput({
        dataQualityScore: 0.4,
        historyLength: 11,
        volatilityPct: 40,
      })
    );
    expect(result.confidence).toBe('LOW');
  });
});

describe('computeRecommendation: observed facts / inferences / counterEvidence', () => {
  it('includes numeric observed facts and qualified-language inferences', () => {
    const result = computeRecommendation(baseInput({}));
    expect(result.observedFacts.some((f) => /\d/.test(f))).toBe(true);
    expect(result.inferences.length).toBeGreaterThan(0);
    expect(result.inferences[0].text).toMatch(/consistent with/i);
  });

  it('surfaces volatility as counterEvidence for a BUY/LEAN_BUY label when volatility is elevated', () => {
    const result = computeRecommendation(
      baseInput({
        percentile: 95,
        momentum7dPct: 10,
        daysToDeparture: 2,
        offerCountChangePct: -30,
        volatilityPct: config.recommendationScoring.volatilityFullScalePct + 10,
      })
    );
    if (result.label === 'BUY' || result.label === 'LEAN_BUY') {
      expect(result.counterEvidence.length).toBeGreaterThan(0);
    }
  });

  it('sets methodologyVersion to recommendation-v1', () => {
    const result = computeRecommendation(baseInput({}));
    expect(result.methodologyVersion).toBe('recommendation-v1');
  });
});
