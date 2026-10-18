CREATE TABLE `price_ticks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`market` text NOT NULL,
	`item_key` text NOT NULL,
	`price` integer NOT NULL,
	`qty` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `price_ticks_item_idx` ON `price_ticks` (`market`,`item_key`,`created_at`);--> statement-breakpoint
ALTER TABLE `supply_listings` ADD `target_id` text;--> statement-breakpoint
ALTER TABLE `supply_listings` ADD `quality` integer DEFAULT 50 NOT NULL;