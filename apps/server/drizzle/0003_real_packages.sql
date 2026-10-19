CREATE TABLE `package_claims` (
	`package_id` text NOT NULL,
	`company_id` text NOT NULL,
	`account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`package_id`, `company_id`)
);
--> statement-breakpoint
CREATE TABLE `real_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`batch_id` text NOT NULL,
	`name` text NOT NULL,
	`emoji` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`contents` text NOT NULL,
	`mystery` integer DEFAULT false NOT NULL,
	`max_claims` integer DEFAULT 1 NOT NULL,
	`claims` integer DEFAULT 0 NOT NULL,
	`target_company_id` text,
	`expires_at` integer,
	`status` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `real_packages_code_idx` ON `real_packages` (`code`);