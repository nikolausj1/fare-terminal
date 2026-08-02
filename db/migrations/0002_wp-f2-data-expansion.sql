CREATE TABLE `calendar_prices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`origin` text NOT NULL,
	`destination` text NOT NULL,
	`depart_date` text NOT NULL,
	`price_minor` integer NOT NULL,
	`transfers` integer NOT NULL,
	`observed_at` integer NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_prices_cell_idx` ON `calendar_prices` (`origin`,`destination`,`depart_date`);--> statement-breakpoint
CREATE INDEX `calendar_prices_route_idx` ON `calendar_prices` (`origin`,`destination`);--> statement-breakpoint
CREATE TABLE `index_values` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`index_date` text NOT NULL,
	`value` real NOT NULL,
	`route_count` integer NOT NULL,
	`methodology_version` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `index_values_index_date_unique` ON `index_values` (`index_date`);--> statement-breakpoint
CREATE TABLE `latest_deals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`origin` text NOT NULL,
	`destination` text NOT NULL,
	`price_minor` integer NOT NULL,
	`depart_date` text,
	`return_date` text,
	`found_at` integer NOT NULL,
	`observed_at` integer NOT NULL,
	`distance_km` real
);
--> statement-breakpoint
CREATE INDEX `latest_deals_found_at_idx` ON `latest_deals` (`found_at`);--> statement-breakpoint
CREATE TABLE `related_fares` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`origin` text NOT NULL,
	`destination` text NOT NULL,
	`price_minor` integer NOT NULL,
	`observed_at` integer NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `related_fares_pair_idx` ON `related_fares` (`origin`,`destination`);--> statement-breakpoint
CREATE INDEX `related_fares_origin_idx` ON `related_fares` (`origin`);