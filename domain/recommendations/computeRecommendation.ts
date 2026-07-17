// Scores a snapshot's derived signals into a RecommendationOutput, per PRD
// §15.5. Pure: every input is passed in explicitly (no DB reads, no clock).

import { config } from '@/domain/config';
import type {
  ConfidenceLevel,
  RecommendationLabel,
  RecommendationOutput,
} from '@/domain/types';

export interface ComputeRecommendationInput {
  /**
   * "Cheaper than X% of history" — see domain/history/percentile.ts. Null
   * when no comparable history exists yet.
   */
  percentile: number | null;
  fairValue: { low: number; high: number; center: number } | null;
  currentBenchmark: number;
  /** % change in benchmark over the trailing 7 days. Positive = rising. */
  momentum7dPct: number | null;
  /** Robust dispersion (MAD/median, %) over recent history. */
  volatilityPct: number | null;
  daysToDeparture: number | null;
  offerCount: number;
  /** % change in valid offer count vs. the prior snapshot. */
  offerCountChangePct: number | null;
  dataQualityScore: number;
  /** Count of compatible historical snapshots available. */
  historyLength: number;
  freshnessSeconds: number;
}

const METHODOLOGY_VERSION = 'recommendation-v1';

// Prices flow through this engine in minor units; user-facing fact strings
// must never leak them raw (e.g. "41700" for $417.00).
function fmtMoney(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * config.percentileToHistoricalValue is calibrated against the standard
 * percentile RANK of the price (0 = cheapest end of history, 100 =
 * priciest end). Our `percentile` input uses the complementary "cheaper
 * than X% of history" framing (see domain/history/percentile.ts), so we
 * convert with `rank = 100 - percentile` before looking the bucket up.
 */
function historicalValueScore(percentile: number | null): number {
  if (percentile === null) return 0;
  const rank = 100 - percentile;
  for (const bucket of config.percentileToHistoricalValue) {
    const passesMin = bucket.exclusiveMin ? rank > bucket.min : rank >= bucket.min;
    if (passesMin && rank <= bucket.max) return bucket.value;
  }
  return 0;
}

// Positive momentum (price has been rising) favors buying now before it
// rises further; negative momentum favors waiting. Linear, clamped to
// [-1, 1] at +/- momentumFullScalePct.
function momentumScore(momentum7dPct: number | null): number {
  if (momentum7dPct === null) return 0;
  return clamp(
    momentum7dPct / config.recommendationScoring.momentumFullScalePct,
    -1,
    1
  );
}

function urgencyScore(daysToDeparture: number | null): number {
  if (daysToDeparture === null) return 0;
  for (const band of config.recommendationScoring.leadTimeBands) {
    if (daysToDeparture >= band.minDays && daysToDeparture <= band.maxDays) {
      return band.value;
    }
  }
  return 0;
}

// A shrinking offer set (negative offerCountChangePct) reads as supply
// tightening -> lean toward buying before it disappears further. A
// growing offer set reads as more competition/deals likely coming -> lean
// toward waiting. Linear, clamped to [-1, 1].
function supplyScore(offerCountChangePct: number | null): number {
  if (offerCountChangePct === null) return 0;
  return clamp(
    -offerCountChangePct / config.recommendationScoring.supplyFullScalePct,
    -1,
    1
  );
}

// Pure penalty: higher volatility lowers confidence in either direction,
// so it only ever subtracts from the score. Clamped to [-1, 0].
function volatilityPenalty(volatilityPct: number | null): number {
  if (volatilityPct === null) return 0;
  return -clamp(
    volatilityPct / config.recommendationScoring.volatilityFullScalePct,
    0,
    1
  );
}

function labelFromScore(score: number): RecommendationLabel {
  const t = config.recommendationThresholds;
  if (score >= t.buy) return 'BUY';
  if (score >= t.leanBuyMin) return 'LEAN_BUY';
  if (score <= t.wait) return 'WAIT';
  return 'NEUTRAL';
}

function confidenceFor(
  dataQualityScore: number,
  historyLength: number,
  volatilityPct: number | null
): ConfidenceLevel {
  const bands = config.recommendationScoring.confidenceBands;
  const vol = volatilityPct ?? 0;

  if (
    dataQualityScore >= bands.highMinQuality &&
    historyLength >= bands.highMinHistory &&
    vol <= bands.highMaxVolatilityPct
  ) {
    return 'HIGH';
  }
  if (
    dataQualityScore >= bands.moderateMinQuality &&
    historyLength >= bands.moderateMinHistory &&
    vol <= bands.moderateMaxVolatilityPct
  ) {
    return 'MODERATE';
  }
  return 'LOW';
}

const LABEL_PHRASE: Record<RecommendationLabel, string> = {
  BUY: 'this looks like a good time to buy',
  LEAN_BUY: 'this leans toward buying soon',
  NEUTRAL: "the signals balance out, so there's no strong case to buy or wait",
  WAIT: 'this suggests waiting for a better price',
  INSUFFICIENT_DATA: "there isn't enough data yet for a confident recommendation",
};

export function computeRecommendation(
  input: ComputeRecommendationInput
): RecommendationOutput {
  const {
    percentile,
    fairValue,
    currentBenchmark,
    momentum7dPct,
    volatilityPct,
    daysToDeparture,
    offerCount,
    offerCountChangePct,
    dataQualityScore,
    historyLength,
    freshnessSeconds,
  } = input;

  // Quality gates: any failure forces INSUFFICIENT_DATA rather than
  // producing a possibly-misleading score.
  const gateFailures: string[] = [];
  const minHistory = config.recommendationScoring.minHistoryForRecommendation;
  if (historyLength < minHistory) {
    gateFailures.push(
      `history has only ${historyLength} compatible snapshot(s), fewer than the ${minHistory} required for a recommendation`
    );
  }
  const staleAfterSeconds = config.freshness.staleAfterMinutes * 60;
  if (freshnessSeconds > staleAfterSeconds) {
    gateFailures.push(
      `data is ${Math.round(freshnessSeconds / 60)} minutes old, staler than the ${config.freshness.staleAfterMinutes}-minute freshness limit`
    );
  }
  const minQuality = config.recommendationScoring.minDataQualityScore;
  if (dataQualityScore < minQuality) {
    gateFailures.push(
      `data quality score ${dataQualityScore.toFixed(2)} is below the ${minQuality} minimum`
    );
  }

  if (gateFailures.length > 0) {
    return {
      label: 'INSUFFICIENT_DATA',
      confidence: 'LOW',
      score: 0,
      summary:
        'There is not enough reliable data yet to make a recommendation for this route.',
      observedFacts: [
        `Current benchmark is ${fmtMoney(currentBenchmark)}.`,
        `History length: ${historyLength} snapshot(s).`,
        `Freshness: ${freshnessSeconds} seconds.`,
        `Data quality score: ${dataQualityScore.toFixed(2)}.`,
      ],
      inferences: [],
      counterEvidence: [],
      limitations: gateFailures,
      methodologyVersion: METHODOLOGY_VERSION,
    };
  }

  const dimHistorical = historicalValueScore(percentile);
  const dimMomentum = momentumScore(momentum7dPct);
  const dimUrgency = urgencyScore(daysToDeparture);
  const dimSupply = supplyScore(offerCountChangePct);
  const dimVolatility = volatilityPenalty(volatilityPct);

  const score = dimHistorical + dimMomentum + dimUrgency + dimSupply + dimVolatility;
  const label = labelFromScore(score);
  const confidence = confidenceFor(dataQualityScore, historyLength, volatilityPct);

  const observedFacts: string[] = [`Current benchmark is ${fmtMoney(currentBenchmark)}.`];
  if (percentile !== null) {
    observedFacts.push(
      `Cheaper than ${percentile.toFixed(1)}% of observed history.`
    );
  }
  if (fairValue) {
    observedFacts.push(
      `Fair value range: ${fmtMoney(fairValue.low)} to ${fmtMoney(fairValue.high)} (center ${fmtMoney(fairValue.center)}).`
    );
  }
  if (momentum7dPct !== null) {
    observedFacts.push(`7-day momentum: ${momentum7dPct.toFixed(1)}%.`);
  }
  if (volatilityPct !== null) {
    observedFacts.push(`Volatility: ${volatilityPct.toFixed(1)}%.`);
  }
  observedFacts.push(`Offer count: ${offerCount}.`);
  if (offerCountChangePct !== null) {
    observedFacts.push(`Offer count change: ${offerCountChangePct.toFixed(1)}%.`);
  }

  const inferences: { text: string; confidence: ConfidenceLevel }[] = [
    {
      text: `A composite score of ${score.toFixed(2)} is consistent with a ${label.replace('_', ' ').toLowerCase()} signal.`,
      confidence,
    },
  ];

  const counterEvidence: string[] = [];
  if (
    volatilityPct !== null &&
    volatilityPct > config.recommendationScoring.volatilityFullScalePct &&
    (label === 'BUY' || label === 'LEAN_BUY')
  ) {
    counterEvidence.push(
      `Recent volatility (${volatilityPct.toFixed(1)}%) is elevated, which adds uncertainty to a buy signal.`
    );
  }
  if (dimMomentum < -0.3 && (label === 'BUY' || label === 'LEAN_BUY')) {
    counterEvidence.push(
      `Momentum has been negative (${momentum7dPct?.toFixed(1)}%), suggesting prices may still be falling.`
    );
  }
  if (dimMomentum > 0.3 && (label === 'WAIT' || label === 'NEUTRAL')) {
    counterEvidence.push(
      `Momentum has been positive (${momentum7dPct?.toFixed(1)}%), suggesting prices may keep rising.`
    );
  }

  const limitations: string[] = [
    `Based on ${historyLength} historical snapshot(s); more history improves confidence.`,
  ];
  if (percentile === null) {
    limitations.push('Historical percentile is unavailable for this route.');
  }
  if (!fairValue) {
    limitations.push('Fair value range is unavailable (insufficient history).');
  }

  // Situation-aware summary: name the dominant drivers rather than a
  // generic per-label phrase, so a NEUTRAL produced by a historically cheap
  // fare offset by falling momentum reads as "mixed signals", not "prices
  // are normal".
  const drivers: string[] = [];
  if (dimHistorical >= 2) {
    drivers.push('the fare is near the cheap end of its comparable history');
  } else if (dimHistorical === 1) {
    drivers.push('the fare is cheaper than usual');
  } else if (dimHistorical === -1) {
    drivers.push('the fare is more expensive than usual');
  } else if (dimHistorical <= -2) {
    drivers.push('the fare is near the expensive end of its comparable history');
  }
  if (dimMomentum <= -0.3) drivers.push('prices have been falling recently');
  else if (dimMomentum >= 0.3) drivers.push('prices have been rising recently');
  if (dimVolatility <= -0.5) drivers.push('volatility is elevated');
  if (dimSupply >= 0.3) drivers.push('the pool of qualifying offers is shrinking');
  else if (dimSupply <= -0.3) drivers.push('more qualifying offers are appearing');

  const phrase = LABEL_PHRASE[label];
  const driverSentence =
    drivers.length > 0
      ? `${drivers[0][0].toUpperCase()}${drivers[0].slice(1)}${
          drivers.length > 1 ? `, and ${drivers.slice(1).join(', and ')}` : ''
        }. `
      : '';
  const summary = `${driverSentence}${phrase[0].toUpperCase()}${phrase.slice(1)}, with ${confidence.toLowerCase()} confidence.`;

  return {
    label,
    confidence,
    score,
    summary,
    observedFacts,
    inferences,
    counterEvidence,
    limitations,
    methodologyVersion: METHODOLOGY_VERSION,
  };
}
