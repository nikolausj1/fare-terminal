CREATE TABLE `google_price_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`search_definition_id` integer NOT NULL,
	`price_date` text NOT NULL,
	`price_minor` integer NOT NULL,
	`captured_at` integer NOT NULL,
	FOREIGN KEY (`search_definition_id`) REFERENCES `search_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_price_history_def_date_idx` ON `google_price_history` (`search_definition_id`,`price_date`);--> statement-breakpoint
CREATE INDEX `google_price_history_def_idx` ON `google_price_history` (`search_definition_id`);--> statement-breakpoint
CREATE TABLE `route_price_insights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`search_definition_id` integer NOT NULL,
	`captured_at` integer NOT NULL,
	`price_level` text NOT NULL,
	`typical_low_minor` integer,
	`typical_high_minor` integer,
	`lowest_price_minor` integer NOT NULL,
	FOREIGN KEY (`search_definition_id`) REFERENCES `search_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `route_price_insights_def_captured_idx` ON `route_price_insights` (`search_definition_id`,`captured_at`);