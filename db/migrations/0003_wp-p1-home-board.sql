CREATE TABLE `city_direction_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`origin` text NOT NULL,
	`destination` text NOT NULL,
	`price_minor` integer NOT NULL,
	`observed_at` integer NOT NULL,
	`found_at` integer
);
--> statement-breakpoint
CREATE INDEX `city_direction_history_route_observed_idx` ON `city_direction_history` (`origin`,`destination`,`observed_at`);
