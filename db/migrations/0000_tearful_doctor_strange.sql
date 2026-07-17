CREATE TABLE `airports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`iata_code` text NOT NULL,
	`icao_code` text,
	`name` text NOT NULL,
	`city_name` text NOT NULL,
	`country_code` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`timezone` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `airports_iata_code_unique` ON `airports` (`iata_code`);--> statement-breakpoint
CREATE TABLE `analyst_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`search_definition_id` integer NOT NULL,
	`market_snapshot_id` integer NOT NULL,
	`recommendation_id` integer NOT NULL,
	`note_text` text NOT NULL,
	`generation_mode` text NOT NULL,
	`model_identifier` text,
	`prompt_version` text NOT NULL,
	`validation_status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`search_definition_id`) REFERENCES `search_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`market_snapshot_id`) REFERENCES `market_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recommendation_id`) REFERENCES `recommendations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `market_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`search_definition_id` integer NOT NULL,
	`event_type` text NOT NULL,
	`event_start_at` integer NOT NULL,
	`event_end_at` integer,
	`severity` text NOT NULL,
	`confidence` text NOT NULL,
	`observed_facts_json` text NOT NULL,
	`inference_json` text,
	`supporting_record_ids` text NOT NULL,
	`detection_rule_version` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`search_definition_id`) REFERENCES `search_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `market_events_def_start_idx` ON `market_events` (`search_definition_id`,`event_start_at`);--> statement-breakpoint
CREATE TABLE `market_scopes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope_type` text NOT NULL,
	`code` text NOT NULL,
	`display_name` text NOT NULL,
	`airport_ids` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `market_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`search_definition_id` integer NOT NULL,
	`snapshot_at` integer NOT NULL,
	`benchmark_price_minor` integer NOT NULL,
	`from_price_minor` integer NOT NULL,
	`median_price_minor` integer NOT NULL,
	`p25_price_minor` integer NOT NULL,
	`valid_offer_count` integer NOT NULL,
	`unique_itinerary_count` integer NOT NULL,
	`carrier_count` integer NOT NULL,
	`nonstop_offer_count` integer NOT NULL,
	`one_stop_offer_count` integer NOT NULL,
	`freshness_seconds` integer NOT NULL,
	`data_quality_score` real NOT NULL,
	`methodology_version` text NOT NULL,
	`source_search_run_ids` text NOT NULL,
	FOREIGN KEY (`search_definition_id`) REFERENCES `search_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `market_snapshots_def_snapshot_idx` ON `market_snapshots` (`search_definition_id`,`snapshot_at`);--> statement-breakpoint
CREATE TABLE `offer_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`search_run_id` integer NOT NULL,
	`search_definition_id` integer NOT NULL,
	`provider_id` text NOT NULL,
	`provider_offer_id` text NOT NULL,
	`itinerary_fingerprint` text NOT NULL,
	`observed_at` integer NOT NULL,
	`expires_at` integer,
	`currency` text NOT NULL,
	`total_price_minor` integer NOT NULL,
	`base_price_minor` integer,
	`taxes_minor` integer,
	`optional_fees_known` integer NOT NULL,
	`validating_carrier` text NOT NULL,
	`marketing_carriers` text NOT NULL,
	`operating_carriers` text NOT NULL,
	`segments_json` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`stop_count` integer NOT NULL,
	`cabin` text NOT NULL,
	`fare_brand` text,
	`booking_classes_json` text,
	`seats_remaining` integer,
	`outbound_url` text,
	`quality_flags` text NOT NULL,
	FOREIGN KEY (`search_run_id`) REFERENCES `search_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`search_definition_id`) REFERENCES `search_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `offer_observations_def_observed_idx` ON `offer_observations` (`search_definition_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `provider_health` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_id` text NOT NULL,
	`checked_at` integer NOT NULL,
	`status` text NOT NULL,
	`latency_ms` integer NOT NULL,
	`error_rate` real NOT NULL,
	`details_json` text
);
--> statement-breakpoint
CREATE TABLE `recommendations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`search_definition_id` integer NOT NULL,
	`market_snapshot_id` integer NOT NULL,
	`label` text NOT NULL,
	`confidence` text NOT NULL,
	`score` real NOT NULL,
	`observed_facts_json` text NOT NULL,
	`inferences_json` text NOT NULL,
	`counterevidence_json` text NOT NULL,
	`limitations_json` text NOT NULL,
	`methodology_version` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`search_definition_id`) REFERENCES `search_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`market_snapshot_id`) REFERENCES `market_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `search_definitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`origin_scope_id` integer NOT NULL,
	`destination_scope_id` integer NOT NULL,
	`mode` text NOT NULL,
	`trip_type` text NOT NULL,
	`departure_date` text,
	`return_date` text,
	`departure_window_start_rule` text,
	`departure_window_end_rule` text,
	`stay_min_nights` integer,
	`stay_max_nights` integer,
	`cabin` text NOT NULL,
	`adults` integer NOT NULL,
	`max_stops` integer NOT NULL,
	`currency` text NOT NULL,
	`point_of_sale` text,
	`benchmark_methodology_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`origin_scope_id`) REFERENCES `market_scopes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_scope_id`) REFERENCES `market_scopes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_definitions_slug_unique` ON `search_definitions` (`slug`);--> statement-breakpoint
CREATE TABLE `search_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`search_definition_id` integer NOT NULL,
	`provider_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`status` text NOT NULL,
	`offer_count_raw` integer NOT NULL,
	`offer_count_normalized` integer NOT NULL,
	`error_code` text,
	FOREIGN KEY (`search_definition_id`) REFERENCES `search_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
