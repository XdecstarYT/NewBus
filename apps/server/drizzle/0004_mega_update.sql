CREATE TABLE `season_pass` (
	`season_id` text NOT NULL,
	`company_id` text NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`claimed` text NOT NULL,
	PRIMARY KEY(`season_id`, `company_id`)
);
