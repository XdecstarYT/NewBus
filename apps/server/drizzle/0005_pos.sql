CREATE TABLE `pos_checkouts` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`seller_id` text NOT NULL,
	`buyer_id` text,
	`order_id` text,
	`items` text NOT NULL,
	`subtotal` integer NOT NULL,
	`discount_pct` integer DEFAULT 0 NOT NULL,
	`tax` integer NOT NULL,
	`total` integer NOT NULL,
	`status` text NOT NULL,
	`created_by` text,
	`paid_by` text,
	`created_at` integer NOT NULL,
	`paid_at` integer,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pos_code_idx` ON `pos_checkouts` (`code`);--> statement-breakpoint
CREATE INDEX `pos_seller_idx` ON `pos_checkouts` (`seller_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `shop_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`pickup_code` text NOT NULL,
	`seller_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`buyer_account_id` text,
	`items` text NOT NULL,
	`subtotal` integer NOT NULL,
	`tax` integer NOT NULL,
	`total` integer NOT NULL,
	`pay_mode` text NOT NULL,
	`paid` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`ready_at` integer,
	`collected_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shop_orders_code_idx` ON `shop_orders` (`pickup_code`);--> statement-breakpoint
CREATE INDEX `shop_orders_seller_idx` ON `shop_orders` (`seller_id`,`status`);--> statement-breakpoint
CREATE INDEX `shop_orders_buyer_idx` ON `shop_orders` (`buyer_id`,`status`);