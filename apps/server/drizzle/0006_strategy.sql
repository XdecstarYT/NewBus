CREATE TABLE `company_strategy` (
	`company_id` text PRIMARY KEY NOT NULL,
	`influence` integer DEFAULT 0 NOT NULL,
	`legal` integer DEFAULT 0 NOT NULL,
	`audit_risk` integer DEFAULT 0 NOT NULL,
	`undeclared` integer DEFAULT 0 NOT NULL,
	`focus_district` text DEFAULT 'downtown' NOT NULL,
	`policies` text NOT NULL,
	`policy_changed_at` integer,
	`actions_run` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `court_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`plaintiff_id` text,
	`defendant_id` text NOT NULL,
	`claim` integer DEFAULT 0 NOT NULL,
	`filing_fee` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`hearing_at` integer NOT NULL,
	`verdict` text,
	`remedy` text,
	`reasoning` text,
	`appealed` integer DEFAULT false NOT NULL,
	`appeal_deadline` integer,
	`settle_offer` integer,
	`settle_from` text,
	`audit_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	`closed_at` integer
);
--> statement-breakpoint
CREATE INDEX `court_cases_def_idx` ON `court_cases` (`defendant_id`);--> statement-breakpoint
CREATE INDEX `court_cases_pl_idx` ON `court_cases` (`plaintiff_id`);--> statement-breakpoint
CREATE INDEX `court_cases_status_idx` ON `court_cases` (`status`);--> statement-breakpoint
CREATE TABLE `court_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`side` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`weight` integer NOT NULL,
	`by_account_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `court_evidence_case_idx` ON `court_evidence` (`case_id`);--> statement-breakpoint
CREATE TABLE `district_presence` (
	`district_id` text NOT NULL,
	`company_id` text NOT NULL,
	`points` real DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`district_id`, `company_id`)
);
--> statement-breakpoint
CREATE TABLE `law_lobby` (
	`law_id` text NOT NULL,
	`company_id` text NOT NULL,
	`side` text NOT NULL,
	`influence` integer NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`law_id`, `company_id`)
);
--> statement-breakpoint
CREATE TABLE `laws` (
	`id` text PRIMARY KEY NOT NULL,
	`template_key` text NOT NULL,
	`title` text NOT NULL,
	`emoji` text NOT NULL,
	`blurb` text NOT NULL,
	`kind` text NOT NULL,
	`value` real NOT NULL,
	`hours` integer NOT NULL,
	`status` text NOT NULL,
	`support` integer DEFAULT 0 NOT NULL,
	`oppose` integer DEFAULT 0 NOT NULL,
	`proposed_by` text,
	`created_at` integer NOT NULL,
	`closes_at` integer NOT NULL,
	`decided_at` integer
);
--> statement-breakpoint
CREATE TABLE `sanctions` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`kind` text NOT NULL,
	`module` text,
	`reason` text NOT NULL,
	`source` text NOT NULL,
	`source_id` text,
	`until` integer NOT NULL,
	`created_at` integer NOT NULL,
	`lifted_at` integer
);
--> statement-breakpoint
CREATE INDEX `sanctions_company_idx` ON `sanctions` (`company_id`,`until`);--> statement-breakpoint
CREATE TABLE `strategy_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`action_id` text NOT NULL,
	`cost` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`ready_at` integer NOT NULL,
	`backfired` integer DEFAULT false NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `strategy_runs_company_idx` ON `strategy_runs` (`company_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `tax_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`depth` text NOT NULL,
	`status` text NOT NULL,
	`findings` text NOT NULL,
	`suggested_fine` integer DEFAULT 0 NOT NULL,
	`fine` integer DEFAULT 0 NOT NULL,
	`outcome` text,
	`note` text,
	`opened_by` text,
	`created_at` integer NOT NULL,
	`closed_at` integer
);
--> statement-breakpoint
CREATE INDEX `tax_audits_company_idx` ON `tax_audits` (`company_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `union_candidates` (
	`election_id` text NOT NULL,
	`company_id` text NOT NULL,
	`pitch` text DEFAULT '' NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`election_id`, `company_id`)
);
--> statement-breakpoint
CREATE TABLE `union_elections` (
	`id` text PRIMARY KEY NOT NULL,
	`union_id` text NOT NULL,
	`office` text NOT NULL,
	`target_id` text,
	`target_office` text,
	`status` text NOT NULL,
	`voting_at` integer NOT NULL,
	`closes_at` integer NOT NULL,
	`winner_id` text,
	`result` text,
	`called_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `union_elections_union_idx` ON `union_elections` (`union_id`,`status`);--> statement-breakpoint
CREATE TABLE `union_members` (
	`company_id` text PRIMARY KEY NOT NULL,
	`union_id` text NOT NULL,
	`rep_account_id` text NOT NULL,
	`joined_at` integer NOT NULL,
	`dues_owed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `union_members_union_idx` ON `union_members` (`union_id`);--> statement-breakpoint
CREATE TABLE `union_votes` (
	`election_id` text NOT NULL,
	`voter_id` text NOT NULL,
	`choice` text NOT NULL,
	`account_id` text NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`election_id`, `voter_id`)
);
--> statement-breakpoint
CREATE TABLE `unions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`emoji` text NOT NULL,
	`motto` text DEFAULT '' NOT NULL,
	`president_id` text,
	`vp_id` text,
	`treasurer_id` text,
	`dues` integer DEFAULT 100 NOT NULL,
	`influence` integer DEFAULT 0 NOT NULL,
	`open` integer DEFAULT true NOT NULL,
	`term_ends_at` integer NOT NULL,
	`dues_day` text,
	`founded_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unions_name_unique` ON `unions` (`name`);