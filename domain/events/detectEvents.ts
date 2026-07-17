// Compares the current snapshot (and its underlying offers) against the
// previous snapshot and trailing history to detect MarketEvents. Pure: no
// DB access, no clock reads (`now` is a parameter).

import { config } from '@/domain/config';
import { itineraryFingerprint } from '@/domain/normalization/fingerprint';
import type {
  ConfidenceLevel,
  EventType,
  MarketEvent,
  NormalizedOffer,
  SnapshotMetrics,
} from '@/domain/types';

export type SnapshotWithTime = SnapshotMetrics & { snapshotAt: number };

export interface DetectEventsInput {
  searchDefinitionId: number;
  current: SnapshotWithTime;
  previous: SnapshotWithTime | null;
  history: SnapshotWithTime[];
  currentOffers: NormalizedOffer[];
  previousOffers: NormalizedOffer[];
  now: number;
}

export type DetectedEvent = Omit<MarketEvent, 'id' | 'createdAt'>;

const DETECTION_RULE_VERSION = 'events-v1';

// ---- shared helpers --------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Signed percent change from `from` to `to`. 0 when `from` is 0. */
function pctChange(from: number, to: number): number {
  if (from === 0) return 0;
  return ((to - from) / from) * 100;
}

function money(amountMinor: number, currency: string): string {
  return `${currency} ${(Math.abs(amountMinor) / 100).toFixed(2)}`;
}

/** Maps "how far past the threshold" into a severity band. */
function severityFromRatio(ratio: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (ratio >= 2) return 'HIGH';
  if (ratio >= 1.3) return 'MEDIUM';
  return 'LOW';
}

function isValidAt(offer: NormalizedOffer, at: number): boolean {
  return (
    !(offer.expiresAt !== undefined && offer.expiresAt < at) &&
    !offer.qualityFlags.includes('SUSPECTED_ANOMALY')
  );
}

function lowSet(
  offers: NormalizedOffer[],
  at: number,
  count: number
): NormalizedOffer[] {
  return offers
    .filter((offer) => isValidAt(offer, at))
    .slice()
    .sort((a, b) => a.totalPriceMinor - b.totalPriceMinor)
    .slice(0, count);
}

function primaryCurrency(offers: NormalizedOffer[]): string {
  return offers[0]?.currency ?? 'USD';
}

function hoursBetween(a: number, b: number): number {
  return Math.abs(a - b) / (1000 * 60 * 60);
}

function baseEvent(
  input: DetectEventsInput,
  eventType: EventType,
  severity: 'LOW' | 'MEDIUM' | 'HIGH',
  confidence: ConfidenceLevel,
  observedFacts: string[],
  inference?: { text: string; confidence: ConfidenceLevel }
): DetectedEvent {
  return {
    searchDefinitionId: input.searchDefinitionId,
    eventType,
    eventStartAt: input.current.snapshotAt,
    severity,
    confidence,
    observedFacts,
    inference,
    supportingRecordIds: [],
    detectionRuleVersion: DETECTION_RULE_VERSION,
  };
}

// ---- detectors ---------------------------------------------------------

function detectPriceMove(input: DetectEventsInput): DetectedEvent[] {
  const { current, previous } = input;
  if (!previous) return [];

  const { priceDropPct, priceDropAbsMinor } = config.eventThresholds;
  const change = pctChange(previous.benchmarkPriceMinor, current.benchmarkPriceMinor);
  const absChange = Math.abs(
    current.benchmarkPriceMinor - previous.benchmarkPriceMinor
  );

  // Fires on either a large enough percentage move OR a large enough
  // absolute move, so it catches both cheap-market swings (small $, big %)
  // and premium-market swings (big $, smaller %).
  const qualifies = Math.abs(change) >= priceDropPct || absChange >= priceDropAbsMinor;
  if (!qualifies) return [];

  const currency = primaryCurrency(input.currentOffers);
  const hrs = Math.round(hoursBetween(current.snapshotAt, previous.snapshotAt));
  const ratio = Math.max(
    Math.abs(change) / priceDropPct,
    absChange / priceDropAbsMinor
  );
  const severity = severityFromRatio(ratio);
  const eventType: EventType = change < 0 ? 'PRICE_DROP' : 'PRICE_INCREASE';
  const verb = change < 0 ? 'fell' : 'rose';

  const facts = [
    `Benchmark ${verb} ${Math.abs(change).toFixed(1)}% (${money(absChange, currency)}) in ${hrs}h.`,
    `Benchmark moved from ${money(previous.benchmarkPriceMinor, currency)} to ${money(current.benchmarkPriceMinor, currency)}.`,
  ];

  return [baseEvent(input, eventType, severity, 'HIGH', facts)];
}

function detectNewHistoricalLow(input: DetectEventsInput): DetectedEvent[] {
  const { current, previous, history } = input;
  const past = [
    ...history.map((h) => h.benchmarkPriceMinor),
    ...(previous ? [previous.benchmarkPriceMinor] : []),
  ];
  if (past.length === 0) return [];

  const priorMin = Math.min(...past);
  if (current.benchmarkPriceMinor >= priorMin) return [];

  const currency = primaryCurrency(input.currentOffers);
  const dropPct = Math.abs(pctChange(priorMin, current.benchmarkPriceMinor));
  const severity = dropPct >= 15 ? 'HIGH' : dropPct >= 5 ? 'MEDIUM' : 'LOW';

  const facts = [
    `New historical low: benchmark ${money(current.benchmarkPriceMinor, currency)} is ${dropPct.toFixed(1)}% below the prior low of ${money(priorMin, currency)}.`,
  ];

  return [baseEvent(input, 'NEW_HISTORICAL_LOW', severity, 'HIGH', facts)];
}

function detectVolatilitySpike(input: DetectEventsInput): DetectedEvent[] {
  const { current, history } = input;
  // Need a reasonable trailing window before "typical" dispersion means
  // anything.
  if (history.length < 5) return [];

  const prices = history.map((h) => h.benchmarkPriceMinor);
  const med = median(prices);
  const mad = median(prices.map((v) => Math.abs(v - med)));
  const currency = primaryCurrency(input.currentOffers);
  const threshold = config.eventThresholds.volatilityMadMultiplier;

  const deviationRatio =
    mad === 0
      ? current.benchmarkPriceMinor === med
        ? 0
        : Infinity
      : Math.abs(current.benchmarkPriceMinor - med) / mad;

  if (deviationRatio < threshold) return [];

  const severity = severityFromRatio(deviationRatio / threshold);
  const deviationText =
    deviationRatio === Infinity ? 'far beyond' : `${deviationRatio.toFixed(1)}x`;

  const facts = [
    `Benchmark ${money(current.benchmarkPriceMinor, currency)} deviates ${deviationText} the recent median absolute deviation from the trailing median of ${money(med, currency)}.`,
  ];

  return [baseEvent(input, 'VOLATILITY_SPIKE', severity, 'MODERATE', facts)];
}

function detectOfferCountChange(input: DetectEventsInput): DetectedEvent[] {
  const { current, previous } = input;
  if (!previous || previous.validOfferCount === 0) return [];

  const { offerCountSurgePct, offerCountContractionPct, offerCountChangeAbsMin } =
    config.eventThresholds;
  const change = pctChange(previous.validOfferCount, current.validOfferCount);
  const absChange = Math.abs(current.validOfferCount - previous.validOfferCount);

  // Percentage thresholds alone are noise on small offer sets.
  if (absChange < offerCountChangeAbsMin) return [];

  if (change >= offerCountSurgePct) {
    const severity = severityFromRatio(change / offerCountSurgePct);
    const facts = [
      `Valid offer count rose ${change.toFixed(1)}% (${previous.validOfferCount} -> ${current.validOfferCount}).`,
    ];
    return [baseEvent(input, 'OFFER_COUNT_SURGE', severity, 'HIGH', facts)];
  }

  if (change <= -offerCountContractionPct) {
    const severity = severityFromRatio(Math.abs(change) / offerCountContractionPct);
    const facts = [
      `Valid offer count fell ${Math.abs(change).toFixed(1)}% (${previous.validOfferCount} -> ${current.validOfferCount}).`,
    ];
    return [baseEvent(input, 'OFFER_COUNT_CONTRACTION', severity, 'HIGH', facts)];
  }

  return [];
}

function detectLowFareSetChanged(input: DetectEventsInput): DetectedEvent[] {
  const { current, previous, currentOffers, previousOffers } = input;
  if (!previous) return [];

  const n = config.benchmark.lowOfferSetSize;
  const currentLow = lowSet(currentOffers, current.snapshotAt, n);
  const previousLow = lowSet(previousOffers, previous.snapshotAt, n);
  if (currentLow.length === 0 || previousLow.length === 0) return [];

  const previousFingerprints = new Set(
    previousLow.map((offer) => itineraryFingerprint(offer.segments))
  );
  const replaced = currentLow.filter(
    (offer) => !previousFingerprints.has(itineraryFingerprint(offer.segments))
  );

  if (replaced.length < config.eventThresholds.lowFareSetChangeCount) return [];

  // Churn without a price consequence is background noise, not an event.
  const benchmarkMovePct = pctChange(
    previous.benchmarkPriceMinor,
    current.benchmarkPriceMinor
  );
  if (
    Math.abs(benchmarkMovePct) <
    config.eventThresholds.lowFareSetMinBenchmarkMovePct
  ) {
    return [];
  }

  const severity = replaced.length >= n - 1 ? 'HIGH' : 'MEDIUM';
  const facts = [
    `${replaced.length} of the ${n} lowest-price itineraries changed since the prior snapshot.`,
    `The benchmark moved ${benchmarkMovePct.toFixed(1)}% over the same interval.`,
  ];

  return [baseEvent(input, 'LOW_FARE_SET_CHANGED', severity, 'MODERATE', facts)];
}

function detectCarrierLowSetChanges(input: DetectEventsInput): DetectedEvent[] {
  const { current, previous, currentOffers, previousOffers } = input;
  if (!previous) return [];

  const n = config.benchmark.lowOfferSetSize;
  const currentLow = lowSet(currentOffers, current.snapshotAt, n);
  const previousLow = lowSet(previousOffers, previous.snapshotAt, n);
  if (currentLow.length === 0 || previousLow.length === 0) return [];

  const currentCarriers = new Set(currentLow.map((o) => o.validatingCarrier));
  const previousCarriers = new Set(previousLow.map((o) => o.validatingCarrier));

  // Only price-competitive membership changes are events. A carrier
  // drifting in or out of slot #5 is churn; a carrier arriving at (or
  // abandoning) the cheap end of the market is a story.
  const proximity =
    1 + config.eventThresholds.carrierSetFromPriceProximityPct / 100;
  const cheapestFor = (offers: NormalizedOffer[], carrier: string): number =>
    Math.min(
      ...offers
        .filter((o) => o.validatingCarrier === carrier)
        .map((o) => o.totalPriceMinor)
    );

  const entered = [...currentCarriers].filter(
    (c) =>
      !previousCarriers.has(c) &&
      cheapestFor(currentLow, c) <= current.fromPriceMinor * proximity
  );
  const left = [...previousCarriers].filter(
    (c) =>
      !currentCarriers.has(c) &&
      cheapestFor(previousLow, c) <= previous.fromPriceMinor * proximity
  );

  const events: DetectedEvent[] = [];

  if (entered.length > 0) {
    events.push(
      baseEvent(
        input,
        'CARRIER_ENTERED_LOW_SET',
        entered.length >= 2 ? 'MEDIUM' : 'LOW',
        'MODERATE',
        [
          `${entered.join(', ')} entered the ${n}-lowest-price set (not represented there previously).`,
        ]
      )
    );
  }
  if (left.length > 0) {
    events.push(
      baseEvent(
        input,
        'CARRIER_LEFT_LOW_SET',
        left.length >= 2 ? 'MEDIUM' : 'LOW',
        'MODERATE',
        [
          `${left.join(', ')} left the ${n}-lowest-price set (present there previously, not now).`,
        ]
      )
    );
  }

  return events;
}

function detectPossibleCarrierMatch(input: DetectEventsInput): DetectedEvent[] {
  const { current, previous, currentOffers, previousOffers } = input;
  if (!previous) return [];

  const windowHours = hoursBetween(current.snapshotAt, previous.snapshotAt);
  if (windowHours > config.eventThresholds.carrierMatchWindowHours) return [];

  const cheapestByCarrier = (offers: NormalizedOffer[], at: number) => {
    const map = new Map<string, number>();
    for (const offer of offers.filter((o) => isValidAt(o, at))) {
      const existing = map.get(offer.validatingCarrier);
      if (existing === undefined || offer.totalPriceMinor < existing) {
        map.set(offer.validatingCarrier, offer.totalPriceMinor);
      }
    }
    return map;
  };

  const currentCheapest = cheapestByCarrier(currentOffers, current.snapshotAt);
  const previousCheapest = cheapestByCarrier(previousOffers, previous.snapshotAt);
  const threshold = config.eventThresholds.carrierMatchMinMovePct;

  const movers: { carrier: string; change: number }[] = [];
  for (const [carrier, prevPrice] of previousCheapest.entries()) {
    const currPrice = currentCheapest.get(carrier);
    if (currPrice === undefined) continue;
    const change = pctChange(prevPrice, currPrice);
    if (Math.abs(change) >= threshold) {
      movers.push({ carrier, change });
    }
  }

  const droppers = movers.filter((m) => m.change < 0);
  const risers = movers.filter((m) => m.change > 0);
  const group = droppers.length >= 2 ? droppers : risers.length >= 2 ? risers : null;
  if (!group) return [];

  const direction = group === droppers ? 'fallen' : 'risen';
  // Deliberately soft language: this is a coincidence-detector, not proof
  // of coordinated pricing.
  const confidence: 'LOW' | 'MODERATE' = group.length >= 3 ? 'MODERATE' : 'LOW';
  const carrierList = group
    .map((m) => `${m.carrier} (${m.change.toFixed(1)}%)`)
    .join(', ');

  const facts = group.map(
    (m) =>
      `${m.carrier}'s cheapest offer moved ${m.change.toFixed(1)}% between snapshots ${windowHours.toFixed(1)}h apart.`
  );

  return [
    baseEvent(
      input,
      'POSSIBLE_CARRIER_MATCH',
      confidence === 'MODERATE' ? 'MEDIUM' : 'LOW',
      confidence,
      facts,
      {
        text: `${group.length} carriers' cheapest fares have ${direction} together (${carrierList}), which is consistent with coordinated pricing but does not confirm it.`,
        confidence,
      }
    ),
  ];
}

function detectFareProductChanges(input: DetectEventsInput): DetectedEvent[] {
  const { current, previous, currentOffers, previousOffers } = input;
  if (!previous) return [];

  const n = config.benchmark.lowOfferSetSize;
  const currentLow = lowSet(currentOffers, current.snapshotAt, n);
  const previousLow = lowSet(previousOffers, previous.snapshotAt, n);
  if (currentLow.length === 0 || previousLow.length === 0) return [];

  // PRD wording is "lowest fare product disappeared/reappeared". The
  // cheapest offers hop between brands constantly, so low-set membership
  // is noise. The real story is a brand vanishing from (or returning to)
  // the ENTIRE observed offer set — e.g. "Basic is no longer sold on this
  // route" — evaluated over all valid offers, and only for the brand that
  // holds (or held) the cheapest branded price.
  const validCurrent = currentOffers.filter((o) => isValidAt(o, current.snapshotAt));
  const validPrevious = previousOffers.filter((o) =>
    isValidAt(o, previous.snapshotAt)
  );
  const brandsOf = (offers: NormalizedOffer[]) =>
    new Set(offers.map((o) => o.fareBrand).filter((b): b is string => !!b));
  const currentBrands = brandsOf(validCurrent);
  const previousBrands = brandsOf(validPrevious);

  const cheapestBrand = (offers: NormalizedOffer[]): string | null => {
    const branded = offers.filter((o) => !!o.fareBrand);
    if (branded.length === 0) return null;
    return branded.reduce((min, o) =>
      o.totalPriceMinor < min.totalPriceMinor ? o : min
    ).fareBrand!;
  };
  const currentCheapestBrand = cheapestBrand(validCurrent);
  const previousCheapestBrand = cheapestBrand(validPrevious);

  const appeared = [...currentBrands].filter(
    (b) => !previousBrands.has(b) && b === currentCheapestBrand
  );
  const disappeared = [...previousBrands].filter(
    (b) => !currentBrands.has(b) && b === previousCheapestBrand
  );

  const events: DetectedEvent[] = [];
  if (appeared.length > 0) {
    events.push(
      baseEvent(
        input,
        'FARE_PRODUCT_APPEARED',
        appeared.length >= 2 ? 'MEDIUM' : 'LOW',
        'MODERATE',
        [
          `Fare product(s) ${appeared.join(', ')} newly appeared in the observed offer set and now hold the cheapest branded fare.`,
        ]
      )
    );
  }
  if (disappeared.length > 0) {
    events.push(
      baseEvent(
        input,
        'FARE_PRODUCT_DISAPPEARED',
        disappeared.length >= 2 ? 'MEDIUM' : 'LOW',
        'MODERATE',
        [
          `Fare product(s) ${disappeared.join(', ')} disappeared from the observed offer set (previously the cheapest branded fare).`,
        ]
      )
    );
  }
  return events;
}

function detectDataAnomaly(input: DetectEventsInput): DetectedEvent[] {
  const { current, currentOffers } = input;
  const anomalousOffers = currentOffers.filter((o) =>
    o.qualityFlags.includes('SUSPECTED_ANOMALY')
  );
  const qualityThreshold = config.eventThresholds.dataAnomalyQualityThreshold;
  const lowQuality = current.dataQualityScore < qualityThreshold;

  if (anomalousOffers.length === 0 && !lowQuality) return [];

  const facts: string[] = [];
  if (anomalousOffers.length > 0) {
    facts.push(
      `${anomalousOffers.length} offer(s) flagged as suspected pricing anomalies.`
    );
  }
  if (lowQuality) {
    facts.push(
      `Data quality score ${current.dataQualityScore.toFixed(2)} is below the ${qualityThreshold} reliability threshold.`
    );
  }

  const severity = current.dataQualityScore < 0.15 ? 'HIGH' : 'MEDIUM';

  return [baseEvent(input, 'DATA_ANOMALY', severity, 'MODERATE', facts)];
}

// ---- entry point ---------------------------------------------------------

export function detectEvents(input: DetectEventsInput): DetectedEvent[] {
  return [
    ...detectPriceMove(input),
    ...detectNewHistoricalLow(input),
    ...detectVolatilitySpike(input),
    ...detectOfferCountChange(input),
    ...detectLowFareSetChanged(input),
    ...detectCarrierLowSetChanges(input),
    ...detectPossibleCarrierMatch(input),
    ...detectFareProductChanges(input),
    ...detectDataAnomaly(input),
  ];
}
