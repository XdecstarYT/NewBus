CREATE TABLE `fair_booths` (
	`fair_id` text NOT NULL,
	`company_id` text NOT NULL,
	`product_id` text NOT NULL,
	`qty` integer NOT NULL,
	`quality` real NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`earned` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`fair_id`, `company_id`)
);
--> statement-breakpoint
CREATE TABLE `mentorships` (
	`id` text PRIMARY KEY NOT NULL,
	`mentor_id` text NOT NULL,
	`mentee_id` text NOT NULL,
	`status` text NOT NULL,
	`start_level` integer NOT NULL,
	`created_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE TABLE `trade_fairs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`theme` text NOT NULL,
	`booth_fee` integer NOT NULL,
	`prize_pool` integer NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`status` text NOT NULL,
	`results` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `guilds` ADD `open` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `guilds` ADD `quest_day` text;--> statement-breakpoint
ALTER TABLE `guilds` ADD `quest_done` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `wars` ADD `contest` text DEFAULT 'sprint' NOT NULL;--> statement-breakpoint
ALTER TABLE `wars` ADD `created_by` text;