// Drizzle sqlite-core schema. Columns are snake_case; prices are stored as
// integer minor units; timestamps are integer epoch millis; JSON columns
// are text with { mode: 'json' }. See docs/ARCHITECTURE.md for how these
// tables map to the domain types in domain/types.ts.

import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

// ---------------------------------------------------------------------------
// WP-F2: data-expansion tables (heatmap / related-markets / deals-feed /
// index-series). See lib/providers/travelpayouts/extras.ts for the adapter
// methods that populate these and jobs/heatmap.ts, jobs/related.ts,
// jobs/deals.ts, jobs/index-series.ts for the ingestion jobs. USD-only by
// design (no currency column) — these are background sweep tables, not
// per-user-query results; see docs comment in extras.ts for why hardcoding
// 'usd' is safe here.
// ---------------------------------------------------------------------------

/** Day-by-day cheapest-price grid from /v2/prices/month-matrix (the P1
 * date-price heatmap's real data source per _review/revamp-data-audit.md —
 * NOT /v1/prices/calendar, which offer_observations/searchFlexible already
 * use for a different purpose). One row per (origin, destination,
 * depart_date) cell.
 *
 * Refresh semantics: "replace per (origin, destination, depart_date)" means
 * jobs/heatmap.ts UPSERTs on the (origin, destination, depart_date) unique
 * index below — a re-fetched cell overwrites the prior row in place (same
 * id, new price/transfers/observed_at) rather than accumulating history.
 * This table is a current-state cache for the heatmap UI, not a time
 * series — trend/history for a route lives in market_snapshots via the
 * existing search_definitions pipeline. Keeping only the newest observation
 * per cell keeps the table small (roster routes x ~90 days, not x every
 * sweep ever run) and matches how the UI will always want "the latest known
 * price for this day", never a per-day history.
 */
export const calendarPrices = sqliteTable(
  'calendar_prices',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    departDate: text('depart_date').notNull(), // YYYY-MM-DD
    priceMinor: integer('price_minor').notNull(),
    transfers: integer('transfers').notNull(),
    observedAt: integer('observed_at').notNull(),
    source: text('source', { enum: ['MONTH_MATRIX'] }).notNull(),
  },
  (table) => [
    // The "replace per cell" unique-ish handling: one row per route/day.
    uniqueIndex('calendar_prices_cell_idx').on(table.origin, table.destination, table.departDate),
    index('calendar_prices_route_idx').on(table.origin, table.destination),
  ]
);

/** Network-wide "recently spotted deals" feed from /v2/prices/latest
 * (unfiltered — per the audit, this endpoint is empty when filtered to a
 * specific origin/destination). Append-only within a 72h retention window;
 * jobs/deals.ts prunes rows older than that on every sweep (see
 * config.deals.retentionHours). Unlike calendar_prices, this table is
 * intentionally a rolling log, not a per-pair latest-only cache — the
 * "recently spotted" framing is inherently about recency/turnover, and the
 * source endpoint itself returns a firehose of distinct routes each call,
 * not a stable per-route cell to overwrite. */
export const latestDeals = sqliteTable(
  'latest_deals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    priceMinor: integer('price_minor').notNull(),
    departDate: text('depart_date'),
    returnDate: text('return_date'),
    // The source's own found_at (when Travelpayouts' cache observed this
    // price) — distinct from observedAt (when THIS adapter retrieved it).
    foundAt: integer('found_at').notNull(),
    observedAt: integer('observed_at').notNull(),
    distanceKm: real('distance_km'),
  },
  (table) => [index('latest_deals_found_at_idx').on(table.foundAt)]
);

/** Destination fares from /v1/city-directions, one row per (origin, dest)
 * pair, powering the "Related Markets" / destinations-explorer feature.
 * Kept as its own dedicated table (not folded into latest_deals) because
 * its refresh semantics match calendar_prices (replace-per-pair, current
 * state only) rather than latest_deals' append-and-prune log — city
 * directions is "the cheapest fare we currently know from this origin to
 * this destination", not a time-ordered feed. No found_at column: this
 * endpoint's response carries expires_at but not a real cache-observation
 * timestamp (unlike month-matrix/prices-latest), so observedAt is this
 * adapter's own retrieval time, same convention as the core provider's
 * prices_for_dates offers (see mapping.ts's buildOffer doc comment). */
export const relatedFares = sqliteTable(
  'related_fares',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    priceMinor: integer('price_minor').notNull(),
    observedAt: integer('observed_at').notNull(),
    source: text('source', { enum: ['CITY_DIRECTIONS'] }).notNull(),
  },
  (table) => [
    uniqueIndex('related_fares_pair_idx').on(table.origin, table.destination),
    index('related_fares_origin_idx').on(table.origin),
  ]
);

/** Daily Fare Terminal Index value — one row per calendar day, computed
 * purely from data already in the DB (market_snapshots), no API calls. See
 * jobs/index-series.ts for the methodology and domain/config.ts#index for
 * the tunables. Idempotent upsert per indexDate. */
export const indexValues = sqliteTable('index_values', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  indexDate: text('index_date').notNull().unique(), // YYYY-MM-DD
  value: real('value').notNull(),
  routeCount: integer('route_count').notNull(),
  methodologyVersion: text('methodology_version').notNull(),
});

/** WP-P1: append-only history of every destination fare /v1/city-directions
 * has ever returned for the owner's home origin (config.homeBoard.origin,
 * SEA) — one row per (origin, destination) observation PER SWEEP, never
 * overwritten. This is the opposite refresh semantics from related_fares
 * (which upsert-replaces "current price per pair" for the Related Markets
 * feature): the home board needs a real time series per destination to
 * drive sparklines/percentile/changePct7d, so jobs/home-board.ts appends a
 * new row here on every sweep in addition to upserting related_fares (kept
 * fresh for that separate feature). Rows are never pruned — this table is
 * origin-scoped to one airport and stays small indefinitely.
 *
 * foundAt is the source's own cache-observation timestamp when
 * city-directions provides one (it doesn't always — see extras.ts's
 * mapCityDirections doc comment, no found_at field on this endpoint
 * currently); observedAt is always this adapter's own sweep time and is
 * what the (origin, destination, observed_at) index and read-layer
 * ordering are keyed on. */
export const cityDirectionHistory = sqliteTable(
  'city_direction_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    priceMinor: integer('price_minor').notNull(),
    observedAt: integer('observed_at').notNull(),
    foundAt: integer('found_at'),
  },
  (table) => [index('city_direction_history_route_observed_idx').on(table.origin, table.destination, table.observedAt)]
);

// ---------------------------------------------------------------------------
// WP-P5: Google's own price-tracking history (price_insights), which rides
// inside every SerpApi Google Flights response. See
// lib/providers/serpapi/mapping.ts#mapPriceInsights (raw -> domain) and
// jobs/ingest.ts's serpapi path (domain -> these tables) for how these get
// populated, and scripts/backfill-price-insights.ts for the one-time
// backfill that gives the roster a ~61-day baseline immediately instead of
// waiting for daily sweeps to accumulate it. Everywhere this data surfaces
// in the UI it must be labeled as Google's tracking, never as this app's
// own observation history (see lib/markets/pinned.ts and the market page).
// ---------------------------------------------------------------------------

/** One (search_definition, calendar day) point from Google's price_history
 * series. UNIQUE(search_definition_id, price_date): a later sweep/backfill
 * re-observing the same route re-upserts the same day's price (Google's
 * tracked value for a given day can itself get revised as it ages inside
 * the ~61-day window) rather than accumulating duplicate rows — "keep
 * latest capture" per day, mirroring calendar_prices' per-cell replace
 * semantics above rather than city_direction_history's append-forever log
 * (this is Google's own already-deduplicated daily series, not a record of
 * every time this app happened to observe it). */
export const googlePriceHistory = sqliteTable(
  'google_price_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    searchDefinitionId: integer('search_definition_id')
      .notNull()
      .references(() => searchDefinitions.id),
    priceDate: text('price_date').notNull(), // YYYY-MM-DD, UTC
    priceMinor: integer('price_minor').notNull(),
    capturedAt: integer('captured_at').notNull(),
  },
  (table) => [
    uniqueIndex('google_price_history_def_date_idx').on(table.searchDefinitionId, table.priceDate),
    index('google_price_history_def_idx').on(table.searchDefinitionId),
  ]
);

/** One row per serpapi search_run that carried a price_insights object —
 * append-only (small: at most one search per definition per day per
 * config.serpapi.sweepsPerDay), unlike google_price_history's per-day
 * upsert. Reading layer always wants "the latest captured insights row for
 * this definition" (see lib/markets/pinned.ts), so append + order-by
 * captured_at desc is simpler and cheaper than trying to collapse this into
 * a single current-state row per definition. */
export const routePriceInsights = sqliteTable(
  'route_price_insights',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    searchDefinitionId: integer('search_definition_id')
      .notNull()
      .references(() => searchDefinitions.id),
    capturedAt: integer('captured_at').notNull(),
    priceLevel: text('price_level').notNull(),
    typicalLowMinor: integer('typical_low_minor'),
    typicalHighMinor: integer('typical_high_minor'),
    lowestPriceMinor: integer('lowest_price_minor').notNull(),
  },
  (table) => [index('route_price_insights_def_captured_idx').on(table.searchDefinitionId, table.capturedAt)]
);
