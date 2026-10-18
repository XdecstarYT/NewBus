CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_number` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`company_id` text,
	`display_name` text NOT NULL,
	`job_title` text,
	`status` text DEFAULT 'active' NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`last_login` integer,
	`last_seen` integer,
	`failed_logins` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`totp_secret` text,
	`totp_enabled` integer DEFAULT false NOT NULL,
	`linked_group` text,
	`moderator_tools` text,
	`settings` text,
	`tutorial_done` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_number_idx` ON `accounts` (`account_number`);--> statement-breakpoint
CREATE INDEX `accounts_company_idx` ON `accounts` (`company_id`);--> statement-breakpoint
CREATE TABLE `achievements` (
	`company_id` text NOT NULL,
	`key` text NOT NULL,
	`unlocked_at` integer NOT NULL,
	PRIMARY KEY(`company_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`company_id` text,
	`price_mode` text NOT NULL,
	`price` integer NOT NULL,
	`fair_value` real NOT NULL,
	`shares_outstanding` integer DEFAULT 0 NOT NULL,
	`primary_remaining` integer DEFAULT 0 NOT NULL,
	`founder_pct` integer DEFAULT 0 NOT NULL,
	`dividend_pct` integer DEFAULT 0 NOT NULL,
	`day_open` integer NOT NULL,
	`day_key` text NOT NULL,
	`halted` integer DEFAULT false NOT NULL,
	`halt_reason` text,
	`halt_until` integer,
	`lockup_until` integer,
	`listed` integer DEFAULT true NOT NULL,
	`data` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_symbol_unique` ON `assets` (`symbol`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`old_value` text,
	`new_value` text,
	`ip` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_target_idx` ON `audit_log` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `blocks` (
	`account_id` text NOT NULL,
	`blocked_id` text NOT NULL,
	PRIMARY KEY(`account_id`, `blocked_id`)
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`kind` text NOT NULL,
	`budget` integer NOT NULL,
	`traffic_mult` real NOT NULL,
	`revenue_during` integer DEFAULT 0 NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`account_id` text NOT NULL,
	`company_id` text,
	`sender_name` text NOT NULL,
	`text` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_channel_idx` ON `chat_messages` (`channel`,`created_at`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`emoji` text NOT NULL,
	`color` text NOT NULL,
	`slogan` text DEFAULT '' NOT NULL,
	`industry_id` text NOT NULL,
	`difficulty` text DEFAULT 'NORMAL' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`fame` integer DEFAULT 0 NOT NULL,
	`reputation` integer DEFAULT 300 NOT NULL,
	`credit_score` integer DEFAULT 650 NOT NULL,
	`prestige_points` integer DEFAULT 0 NOT NULL,
	`prestige_count` integer DEFAULT 0 NOT NULL,
	`lifetime_earned` integer DEFAULT 0 NOT NULL,
	`run_earned` integer DEFAULT 0 NOT NULL,
	`streak` integer DEFAULT 0 NOT NULL,
	`last_streak_claim` integer,
	`pity_epic` integer DEFAULT 0 NOT NULL,
	`pity_legendary` integer DEFAULT 0 NOT NULL,
	`warehouse_level` integer DEFAULT 1 NOT NULL,
	`research` text,
	`settings` text,
	`guild_id` text,
	`last_tick_at` integer NOT NULL,
	`last_active_at` integer NOT NULL,
	`last_seen_summary_at` integer,
	`income_per_tick` integer DEFAULT 0 NOT NULL,
	`wages_per_tick` integer DEFAULT 0 NOT NULL,
	`ipo_status` text DEFAULT 'none' NOT NULL,
	`ipo_request` text,
	`trophies` text,
	`title` text,
	`theme` text,
	`created_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `companies_industry_idx` ON `companies` (`industry_id`);--> statement-breakpoint
CREATE TABLE `company_events` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`event_key` text NOT NULL,
	`data` text NOT NULL,
	`status` text NOT NULL,
	`choice` integer,
	`outcome` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_company_idx` ON `company_events` (`company_id`,`status`);--> statement-breakpoint
CREATE TABLE `company_products` (
	`company_id` text NOT NULL,
	`product_id` text NOT NULL,
	`price` integer NOT NULL,
	`on_sale` integer DEFAULT true NOT NULL,
	`auto_restock` integer DEFAULT 0 NOT NULL,
	`sold` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`company_id`, `product_id`)
);
--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`data` text NOT NULL,
	`status` text NOT NULL,
	`target` integer NOT NULL,
	`bonus_target` integer NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`reward` integer NOT NULL,
	`bonus_reward` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`started_at` integer,
	`ends_at` integer,
	`expires_at` integer NOT NULL,
	`counterparty_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contracts_company_idx` ON `contracts` (`company_id`,`status`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`product_id` text,
	`bought` integer NOT NULL,
	`satisfaction` integer NOT NULL,
	`spent` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customers_company_idx` ON `customers` (`company_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `dividends` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`holder_id` text,
	`amount` integer NOT NULL,
	`reinvested_qty` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `feature_flags` (
	`key` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `flags` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`company_id` text,
	`account_id` text,
	`detail` text NOT NULL,
	`severity` integer DEFAULT 1 NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `flags_created_idx` ON `flags` (`created_at`);--> statement-breakpoint
CREATE TABLE `guild_members` (
	`guild_id` text NOT NULL,
	`company_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`guild_id`, `company_id`)
);
--> statement-breakpoint
CREATE TABLE `guilds` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`emoji` text NOT NULL,
	`motto` text DEFAULT '' NOT NULL,
	`leader_id` text NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guilds_name_unique` ON `guilds` (`name`);--> statement-breakpoint
CREATE TABLE `holdings` (
	`holder_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`qty` integer NOT NULL,
	`cost_basis` integer NOT NULL,
	`drip` integer DEFAULT false NOT NULL,
	`acquired_at` integer NOT NULL,
	PRIMARY KEY(`holder_id`, `asset_id`)
);
--> statement-breakpoint
CREATE TABLE `indexes` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`rule` text NOT NULL,
	`value` real NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `indexes_symbol_unique` ON `indexes` (`symbol`);--> statement-breakpoint
CREATE TABLE `industries` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`data` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`custom` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `insurance_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`kind` text NOT NULL,
	`premium` integer NOT NULL,
	`active_until` integer NOT NULL,
	`claims` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory` (
	`company_id` text NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`qty` integer DEFAULT 0 NOT NULL,
	`quality` integer DEFAULT 50 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`company_id`, `item_type`, `item_id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`from_company` text NOT NULL,
	`to_company` text NOT NULL,
	`amount` integer NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`escrow` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text,
	`item_key` text NOT NULL,
	`kind` text NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`equipped` integer DEFAULT false NOT NULL,
	`workplace_id` text,
	`listed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `items_company_idx` ON `items` (`company_id`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tx_id` text NOT NULL,
	`from_wallet` text NOT NULL,
	`to_wallet` text NOT NULL,
	`amount` integer NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ledger_from_idx` ON `ledger_entries` (`from_wallet`,`created_at`);--> statement-breakpoint
CREATE INDEX `ledger_to_idx` ON `ledger_entries` (`to_wallet`,`created_at`);--> statement-breakpoint
CREATE INDEX `ledger_tx_idx` ON `ledger_entries` (`tx_id`);--> statement-breakpoint
CREATE INDEX `ledger_kind_idx` ON `ledger_entries` (`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `ledger_tx` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`memo` text,
	`idempotency_key` text,
	`actor_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_tx_idem_idx` ON `ledger_tx` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ledger_tx_created_idx` ON `ledger_tx` (`created_at`);--> statement-breakpoint
CREATE TABLE `loans` (
	`id` text PRIMARY KEY NOT NULL,
	`borrower_id` text NOT NULL,
	`lender_type` text NOT NULL,
	`lender_id` text,
	`principal` integer NOT NULL,
	`outstanding` integer NOT NULL,
	`rate_bps` integer NOT NULL,
	`installment` integer NOT NULL,
	`installments_left` integer NOT NULL,
	`next_due_at` integer NOT NULL,
	`missed` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `loans_borrower_idx` ON `loans` (`borrower_id`,`status`);--> statement-breakpoint
CREATE TABLE `market_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`seller_id` text NOT NULL,
	`item_type` text NOT NULL,
	`item_ref` text NOT NULL,
	`title` text NOT NULL,
	`buy_now_price` integer,
	`start_price` integer NOT NULL,
	`high_bid` integer,
	`high_bidder` text,
	`ends_at` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `market_status_idx` ON `market_listings` (`status`,`ends_at`);--> statement-breakpoint
CREATE TABLE `minigame_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`game` text NOT NULL,
	`seed` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`score` integer,
	`payout` integer,
	`flagged` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mg_company_idx` ON `minigame_sessions` (`company_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `modifiers` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text,
	`kind` text NOT NULL,
	`value` real NOT NULL,
	`source` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `modifiers_company_idx` ON `modifiers` (`company_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `mutes` (
	`account_id` text PRIMARY KEY NOT NULL,
	`until` integer NOT NULL,
	`reason` text,
	`by_id` text
);
--> statement-breakpoint
CREATE TABLE `news` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`headline` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`company_id` text,
	`reactions` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `news_created_idx` ON `news` (`created_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text,
	`account_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`reward` integer,
	`claimed` integer DEFAULT false NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notif_company_idx` ON `notifications` (`company_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`holder_id` text NOT NULL,
	`side` text NOT NULL,
	`type` text NOT NULL,
	`qty` integer NOT NULL,
	`filled` integer DEFAULT 0 NOT NULL,
	`limit_price` integer,
	`reserved` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `orders_book_idx` ON `orders` (`asset_id`,`status`,`side`);--> statement-breakpoint
CREATE TABLE `permission_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	PRIMARY KEY(`subject_type`, `subject_id`)
);
--> statement-breakpoint
CREATE TABLE `price_history` (
	`asset_id` text NOT NULL,
	`bucket` integer NOT NULL,
	`o` integer NOT NULL,
	`h` integer NOT NULL,
	`l` integer NOT NULL,
	`c` integer NOT NULL,
	`v` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`asset_id`, `bucket`)
);
--> statement-breakpoint
CREATE TABLE `production_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`workplace_id` text NOT NULL,
	`product_id` text NOT NULL,
	`qty` integer NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`quality` integer DEFAULT 0 NOT NULL,
	`ms_per_unit` integer NOT NULL,
	`progress_ms` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_company_idx` ON `production_jobs` (`company_id`,`status`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`industry_id` text NOT NULL,
	`name` text NOT NULL,
	`data` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `products_industry_idx` ON `products` (`industry_id`);--> statement-breakpoint
CREATE TABLE `properties` (
	`id` text PRIMARY KEY NOT NULL,
	`district` text NOT NULL,
	`plot` integer NOT NULL,
	`kind` text NOT NULL,
	`owner_company_id` text,
	`price` integer NOT NULL,
	`rent_price` integer NOT NULL,
	`rented_to` text,
	`traffic` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`proposer_id` text NOT NULL,
	`yes` integer DEFAULT 0 NOT NULL,
	`no` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`ends_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quests` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`key` text NOT NULL,
	`period` text NOT NULL,
	`stat` text NOT NULL,
	`baseline` integer NOT NULL,
	`target` integer NOT NULL,
	`reward` integer NOT NULL,
	`pass_xp` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quests_company_idx` ON `quests` (`company_id`,`status`);--> statement-breakpoint
CREATE TABLE `recipes` (
	`product_id` text NOT NULL,
	`input_id` text NOT NULL,
	`qty` integer NOT NULL,
	PRIMARY KEY(`product_id`, `input_id`)
);
--> statement-breakpoint
CREATE TABLE `relationships` (
	`worker_a` text NOT NULL,
	`worker_b` text NOT NULL,
	`kind` text NOT NULL,
	PRIMARY KEY(`worker_a`, `worker_b`)
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`product_id` text NOT NULL,
	`stars` integer NOT NULL,
	`text` text NOT NULL,
	`customer_type` text NOT NULL,
	`customer_name` text NOT NULL,
	`reply` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reviews_company_idx` ON `reviews` (`company_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sales_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`product_id` text NOT NULL,
	`qty` integer NOT NULL,
	`unit_price` integer NOT NULL,
	`total` integer NOT NULL,
	`channel` text NOT NULL,
	`customer_type` text,
	`buyer_company_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sales_company_idx` ON `sales_orders` (`company_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sales_product_idx` ON `sales_orders` (`product_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `savings` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`rate_bps` integer NOT NULL,
	`starts_at` integer NOT NULL,
	`matures_at` integer NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `savings_company_idx` ON `savings` (`company_id`);--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`name` text NOT NULL,
	`theme` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`status` text NOT NULL,
	`winners` text
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`ip` text,
	`user_agent` text
);
--> statement-breakpoint
CREATE INDEX `sessions_account_idx` ON `sessions` (`account_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `snapshots_scope_idx` ON `snapshots` (`scope`,`created_at`);--> statement-breakpoint
CREATE TABLE `stats` (
	`company_id` text NOT NULL,
	`key` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`company_id`, `key`)
);
--> statement-breakpoint
CREATE INDEX `stats_key_idx` ON `stats` (`key`,`value`);--> statement-breakpoint
CREATE TABLE `supply_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`seller_id` text NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`qty` integer NOT NULL,
	`unit_price` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`seller_id` text NOT NULL,
	`qty` integer NOT NULL,
	`price` integer NOT NULL,
	`fee` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trades_asset_idx` ON `trades` (`asset_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `trades_buyer_idx` ON `trades` (`buyer_id`);--> statement-breakpoint
CREATE INDEX `trades_seller_idx` ON `trades` (`seller_id`);--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`kind` text NOT NULL,
	`capacity` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `votes` (
	`proposal_id` text NOT NULL,
	`holder_id` text NOT NULL,
	`weight` integer NOT NULL,
	`choice` integer NOT NULL,
	PRIMARY KEY(`proposal_id`, `holder_id`)
);
--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`pot` text DEFAULT 'main' NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_owner_idx` ON `wallets` (`owner_type`,`owner_id`,`pot`);--> statement-breakpoint
CREATE TABLE `war_participants` (
	`war_id` text NOT NULL,
	`side_id` text NOT NULL,
	`baseline` integer DEFAULT 0 NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`war_id`, `side_id`)
);
--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wars` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`metric` text NOT NULL,
	`prize` integer NOT NULL,
	`consolation` integer NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`status` text NOT NULL,
	`winner_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watchlist` (
	`company_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`alert_above` integer,
	`alert_below` integer,
	PRIMARY KEY(`company_id`, `asset_id`)
);
--> statement-breakpoint
CREATE TABLE `workers` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text,
	`name` text NOT NULL,
	`species` text NOT NULL,
	`archetype` text NOT NULL,
	`role` text NOT NULL,
	`rarity` text NOT NULL,
	`quirk` text NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`energy` integer DEFAULT 100 NOT NULL,
	`mood` integer DEFAULT 70 NOT NULL,
	`skills` text NOT NULL,
	`appearance` text NOT NULL,
	`workplace_id` text,
	`desk` integer,
	`coffee_until` integer,
	`nap_until` integer,
	`listed` integer DEFAULT false NOT NULL,
	`industry_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workers_company_idx` ON `workers` (`company_id`);--> statement-breakpoint
CREATE TABLE `workplaces` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`kind` integer NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`skin` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workplaces_company_idx` ON `workplaces` (`company_id`);