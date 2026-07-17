// Drizzle sqlite-core schema. Columns are snake_case; prices are stored as
// integer minor units; timestamps are integer epoch millis; JSON columns
// are text with { mode: 'json' }. See docs/ARCHITECTURE.md for how these
// tables map to the domain types in domain/types.ts.

import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const airports = sqliteTable('airports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  iataCode: text('iata_code').notNull().unique(),
  icaoCode: text('icao_code'),
  name: text('name').notNull(),
  cityName: text('city_name').notNull(),
  countryCode: text('country_code').notNull(),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  timezone: text('timezone').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

export const marketScopes = sqliteTable('market_scopes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scopeType: text('scope_type', { enum: ['AIRPORT', 'CITY'] }).notNull(),
  code: text('code').notNull(),
  displayName: text('display_name').notNull(),
  airportIds: text('airport_ids', { mode: 'json' })
    .$type<number[]>()
    .notNull(),
});

export const searchDefinitions = sqliteTable('search_definitions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  originScopeId: integer('origin_scope_id')
    .notNull()
    .references(() => marketScopes.id),
  destinationScopeId: integer('destination_scope_id')
    .notNull()
    .references(() => marketScopes.id),
  mode: text('mode', { enum: ['FLEXIBLE', 'EXACT'] }).notNull(),
  tripType: text('trip_type', { enum: ['ROUND_TRIP', 'ONE_WAY'] }).notNull(),
  departureDate: text('departure_date'),
  returnDate: text('return_date'),
  departureWindowStartRule: text('departure_window_start_rule'),
  departureWindowEndRule: text('departure_window_end_rule'),
  stayMinNights: integer('stay_min_nights'),
  stayMaxNights: integer('stay_max_nights'),
  cabin: text('cabin').notNull(),
  adults: integer('adults').notNull(),
  maxStops: integer('max_stops').notNull(),
  currency: text('currency').notNull(),
  pointOfSale: text('point_of_sale'),
  benchmarkMethodologyVersion: text('benchmark_methodology_version').notNull(),
  createdAt: integer('created_at').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

export const searchRuns = sqliteTable('search_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  searchDefinitionId: integer('search_definition_id')
    .notNull()
    .references(() => searchDefinitions.id),
  providerId: text('provider_id').notNull(),
  startedAt: integer('started_at').notNull(),
  completedAt: integer('completed_at'),
  status: text('status').notNull(),
  offerCountRaw: integer('offer_count_raw').notNull(),
  offerCountNormalized: integer('offer_count_normalized').notNull(),
  errorCode: text('error_code'),
});

export const offerObservations = sqliteTable(
  'offer_observations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    searchRunId: integer('search_run_id')
      .notNull()
      .references(() => searchRuns.id),
    searchDefinitionId: integer('search_definition_id')
      .notNull()
      .references(() => searchDefinitions.id),
    providerId: text('provider_id').notNull(),
    providerOfferId: text('provider_offer_id').notNull(),
    itineraryFingerprint: text('itinerary_fingerprint').notNull(),
    observedAt: integer('observed_at').notNull(),
    expiresAt: integer('expires_at'),
    currency: text('currency').notNull(),
    totalPriceMinor: integer('total_price_minor').notNull(),
    basePriceMinor: integer('base_price_minor'),
    taxesMinor: integer('taxes_minor'),
    optionalFeesKnown: integer('optional_fees_known', {
      mode: 'boolean',
    }).notNull(),
    validatingCarrier: text('validating_carrier').notNull(),
    marketingCarriers: text('marketing_carriers', { mode: 'json' })
      .$type<string[]>()
      .notNull(),
    operatingCarriers: text('operating_carriers', { mode: 'json' })
      .$type<string[]>()
      .notNull(),
    segmentsJson: text('segments_json', { mode: 'json' })
      .$type<unknown[]>()
      .notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    stopCount: integer('stop_count').notNull(),
    cabin: text('cabin').notNull(),
    fareBrand: text('fare_brand'),
    bookingClassesJson: text('booking_classes_json', { mode: 'json' }).$type<
      string[]
    >(),
    seatsRemaining: integer('seats_remaining'),
    outboundUrl: text('outbound_url'),
    qualityFlags: text('quality_flags', { mode: 'json' })
      .$type<string[]>()
      .notNull(),
  },
  (table) => [
    index('offer_observations_def_observed_idx').on(
      table.searchDefinitionId,
      table.observedAt
    ),
  ]
);

export const marketSnapshots = sqliteTable(
  'market_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    searchDefinitionId: integer('search_definition_id')
      .notNull()
      .references(() => searchDefinitions.id),
    snapshotAt: integer('snapshot_at').notNull(),
    benchmarkPriceMinor: integer('benchmark_price_minor').notNull(),
    fromPriceMinor: integer('from_price_minor').notNull(),
    medianPriceMinor: integer('median_price_minor').notNull(),
    p25PriceMinor: integer('p25_price_minor').notNull(),
    validOfferCount: integer('valid_offer_count').notNull(),
    uniqueItineraryCount: integer('unique_itinerary_count').notNull(),
    carrierCount: integer('carrier_count').notNull(),
    nonstopOfferCount: integer('nonstop_offer_count').notNull(),
    oneStopOfferCount: integer('one_stop_offer_count').notNull(),
    freshnessSeconds: integer('freshness_seconds').notNull(),
    dataQualityScore: real('data_quality_score').notNull(),
    methodologyVersion: text('methodology_version').notNull(),
    sourceSearchRunIds: text('source_search_run_ids', { mode: 'json' })
      .$type<number[]>()
      .notNull(),
  },
  (table) => [
    index('market_snapshots_def_snapshot_idx').on(
      table.searchDefinitionId,
      table.snapshotAt
    ),
  ]
);

export const marketEvents = sqliteTable(
  'market_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    searchDefinitionId: integer('search_definition_id')
      .notNull()
      .references(() => searchDefinitions.id),
    eventType: text('event_type').notNull(),
    eventStartAt: integer('event_start_at').notNull(),
    eventEndAt: integer('event_end_at'),
    severity: text('severity', { enum: ['LOW', 'MEDIUM', 'HIGH'] }).notNull(),
    confidence: text('confidence', {
      enum: ['LOW', 'MODERATE', 'HIGH'],
    }).notNull(),
    observedFactsJson: text('observed_facts_json', { mode: 'json' })
      .$type<string[]>()
      .notNull(),
    inferenceJson: text('inference_json', { mode: 'json' }).$type<{
      text: string;
      confidence: 'LOW' | 'MODERATE' | 'HIGH';
    }>(),
    supportingRecordIds: text('supporting_record_ids', { mode: 'json' })
      .$type<number[]>()
      .notNull(),
    detectionRuleVersion: text('detection_rule_version').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('market_events_def_start_idx').on(
      table.searchDefinitionId,
      table.eventStartAt
    ),
  ]
);

export const recommendations = sqliteTable('recommendations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  searchDefinitionId: integer('search_definition_id')
    .notNull()
    .references(() => searchDefinitions.id),
  marketSnapshotId: integer('market_snapshot_id')
    .notNull()
    .references(() => marketSnapshots.id),
  label: text('label', {
    enum: ['BUY', 'LEAN_BUY', 'NEUTRAL', 'WAIT', 'INSUFFICIENT_DATA'],
  }).notNull(),
  confidence: text('confidence', {
    enum: ['LOW', 'MODERATE', 'HIGH'],
  }).notNull(),
  score: real('score').notNull(),
  summary: text('summary').notNull().default(''),
  observedFactsJson: text('observed_facts_json', { mode: 'json' })
    .$type<string[]>()
    .notNull(),
  inferencesJson: text('inferences_json', { mode: 'json' })
    .$type<{ text: string; confidence: 'LOW' | 'MODERATE' | 'HIGH' }[]>()
    .notNull(),
  counterevidenceJson: text('counterevidence_json', { mode: 'json' })
    .$type<string[]>()
    .notNull(),
  limitationsJson: text('limitations_json', { mode: 'json' })
    .$type<string[]>()
    .notNull(),
  methodologyVersion: text('methodology_version').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const analystNotes = sqliteTable('analyst_notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  searchDefinitionId: integer('search_definition_id')
    .notNull()
    .references(() => searchDefinitions.id),
  marketSnapshotId: integer('market_snapshot_id')
    .notNull()
    .references(() => marketSnapshots.id),
  recommendationId: integer('recommendation_id')
    .notNull()
    .references(() => recommendations.id),
  noteText: text('note_text').notNull(),
  generationMode: text('generation_mode', {
    enum: ['LLM', 'TEMPLATE'],
  }).notNull(),
  modelIdentifier: text('model_identifier'),
  promptVersion: text('prompt_version').notNull(),
  validationStatus: text('validation_status').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const providerHealth = sqliteTable('provider_health', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  providerId: text('provider_id').notNull(),
  checkedAt: integer('checked_at').notNull(),
  status: text('status').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  errorRate: real('error_rate').notNull(),
  detailsJson: text('details_json', { mode: 'json' }).$type<unknown>(),
});
