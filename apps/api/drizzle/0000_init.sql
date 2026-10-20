CREATE SCHEMA "live";
--> statement-breakpoint
CREATE TABLE "live"."accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"company_id" text,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" bigint,
	"energy" real DEFAULT 100 NOT NULL,
	"energy_at" bigint NOT NULL,
	"xp" bigint DEFAULT 0 NOT NULL,
	"muted_until" bigint,
	"created_at" bigint NOT NULL,
	"last_seen" bigint
);
--> statement-breakpoint
CREATE TABLE "live"."audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target" text,
	"data" jsonb,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live"."audits" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"status" text NOT NULL,
	"findings" jsonb NOT NULL,
	"suggested_fine" integer DEFAULT 0 NOT NULL,
	"fine" integer DEFAULT 0 NOT NULL,
	"outcome" text,
	"note" text,
	"created_at" bigint NOT NULL,
	"closed_at" bigint
);
--> statement-breakpoint
CREATE TABLE "live"."ballots" (
	"election_id" text NOT NULL,
	"voter_id" text NOT NULL,
	"choice" text NOT NULL,
	"at" bigint NOT NULL,
	CONSTRAINT "ballots_election_id_voter_id_pk" PRIMARY KEY("election_id","voter_id")
);
--> statement-breakpoint
CREATE TABLE "live"."candidates" (
	"election_id" text NOT NULL,
	"company_id" text NOT NULL,
	"pitch" text DEFAULT '' NOT NULL,
	"at" bigint NOT NULL,
	CONSTRAINT "candidates_election_id_company_id_pk" PRIMARY KEY("election_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "live"."cases" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"plaintiff_id" text,
	"defendant_id" text NOT NULL,
	"claim" integer DEFAULT 0 NOT NULL,
	"fee" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"hearing_at" bigint NOT NULL,
	"verdict" text,
	"remedy" jsonb,
	"reasoning" text,
	"appealed" boolean DEFAULT false NOT NULL,
	"appeal_deadline" bigint,
	"settle_offer" integer,
	"settle_from" text,
	"created_at" bigint NOT NULL,
	"closed_at" bigint
);
--> statement-breakpoint
CREATE TABLE "live"."chat" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"account_id" text NOT NULL,
	"company_id" text,
	"name" text NOT NULL,
	"text" text NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live"."checkouts" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"seller_id" text NOT NULL,
	"buyer_id" text,
	"order_id" text,
	"lines" jsonb NOT NULL,
	"total" integer NOT NULL,
	"status" text NOT NULL,
	"created_by" text,
	"created_at" bigint NOT NULL,
	"paid_at" bigint,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live"."companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"emoji" text NOT NULL,
	"color" text NOT NULL,
	"slogan" text DEFAULT '' NOT NULL,
	"industry" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"tool_uses" integer DEFAULT 0 NOT NULL,
	"installs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prestige" integer DEFAULT 0 NOT NULL,
	"xp" bigint DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "companies_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "live"."elections" (
	"id" text PRIMARY KEY NOT NULL,
	"union_id" text NOT NULL,
	"office" text NOT NULL,
	"target_id" text,
	"target_office" text,
	"status" text NOT NULL,
	"voting_at" bigint NOT NULL,
	"closes_at" bigint NOT NULL,
	"winner_id" text,
	"result" jsonb,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live"."evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"side" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"weight" integer NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live"."facilities" (
	"company_id" text NOT NULL,
	"type" text NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"batches" bigint DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "facilities_company_id_type_pk" PRIMARY KEY("company_id","type")
);
--> statement-breakpoint
CREATE TABLE "live"."inventory" (
	"company_id" text NOT NULL,
	"item" text NOT NULL,
	"qty" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "inventory_company_id_item_pk" PRIMARY KEY("company_id","item")
);
--> statement-breakpoint
CREATE TABLE "live"."law_votes" (
	"law_id" text NOT NULL,
	"company_id" text NOT NULL,
	"vote" text NOT NULL,
	"at" bigint NOT NULL,
	CONSTRAINT "law_votes_law_id_company_id_pk" PRIMARY KEY("law_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "live"."laws" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"value" integer NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"yes" integer DEFAULT 0 NOT NULL,
	"no" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"closes_at" bigint NOT NULL,
	"decided_at" bigint
);
--> statement-breakpoint
CREATE TABLE "live"."ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"tx_id" text NOT NULL,
	"kind" text NOT NULL,
	"from_wallet" text NOT NULL,
	"to_wallet" text NOT NULL,
	"amount" bigint NOT NULL,
	"memo" text,
	"actor_id" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live"."listings" (
	"company_id" text NOT NULL,
	"item" text NOT NULL,
	"price" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "listings_company_id_item_pk" PRIMARY KEY("company_id","item")
);
--> statement-breakpoint
CREATE TABLE "live"."news" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"headline" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"company_id" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live"."notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text,
	"account_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live"."orders" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"account_id" text NOT NULL,
	"item" text NOT NULL,
	"side" text NOT NULL,
	"price" integer NOT NULL,
	"qty" integer NOT NULL,
	"filled" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live"."pickups" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"seller_id" text NOT NULL,
	"buyer_id" text NOT NULL,
	"lines" jsonb NOT NULL,
	"total" integer NOT NULL,
	"status" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" bigint NOT NULL,
	"done_at" bigint
);
--> statement-breakpoint
CREATE TABLE "live"."reward_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"bits" integer DEFAULT 0 NOT NULL,
	"items" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"uses_left" integer NOT NULL,
	"created_by" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live"."reward_redemptions" (
	"code" text NOT NULL,
	"company_id" text NOT NULL,
	"at" bigint NOT NULL,
	CONSTRAINT "reward_redemptions_code_company_id_pk" PRIMARY KEY("code","company_id")
);
--> statement-breakpoint
CREATE TABLE "live"."sanctions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"kind" text NOT NULL,
	"feature" text,
	"reason" text NOT NULL,
	"until" bigint NOT NULL,
	"lifted_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live"."sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"last_seen" bigint NOT NULL,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "live"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live"."trades" (
	"id" text PRIMARY KEY NOT NULL,
	"item" text NOT NULL,
	"price" integer NOT NULL,
	"qty" integer NOT NULL,
	"buyer_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"tax" integer NOT NULL,
	"venue" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live"."union_members" (
	"company_id" text PRIMARY KEY NOT NULL,
	"union_id" text NOT NULL,
	"rep_account_id" text NOT NULL,
	"joined_at" bigint NOT NULL,
	"dues_owed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live"."unions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"emoji" text NOT NULL,
	"motto" text DEFAULT '' NOT NULL,
	"president_id" text,
	"vp_id" text,
	"treasurer_id" text,
	"dues" integer DEFAULT 50 NOT NULL,
	"open" boolean DEFAULT true NOT NULL,
	"term_ends_at" bigint NOT NULL,
	"dues_day" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "unions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "live"."wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live"."work_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"account_id" text NOT NULL,
	"facility" text NOT NULL,
	"recipe" text NOT NULL,
	"batches" integer NOT NULL,
	"output" jsonb NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_number_idx" ON "live"."accounts" USING btree ("number");--> statement-breakpoint
CREATE INDEX "accounts_company_idx" ON "live"."accounts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "cases_def_idx" ON "live"."cases" USING btree ("defendant_id");--> statement-breakpoint
CREATE INDEX "cases_pl_idx" ON "live"."cases" USING btree ("plaintiff_id");--> statement-breakpoint
CREATE INDEX "cases_status_idx" ON "live"."cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "chat_channel_idx" ON "live"."chat" USING btree ("channel","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "checkouts_code_idx" ON "live"."checkouts" USING btree ("code");--> statement-breakpoint
CREATE INDEX "checkouts_seller_idx" ON "live"."checkouts" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "elections_union_idx" ON "live"."elections" USING btree ("union_id","status");--> statement-breakpoint
CREATE INDEX "evidence_case_idx" ON "live"."evidence" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "ledger_from_idx" ON "live"."ledger" USING btree ("from_wallet","created_at");--> statement-breakpoint
CREATE INDEX "ledger_to_idx" ON "live"."ledger" USING btree ("to_wallet","created_at");--> statement-breakpoint
CREATE INDEX "notifications_company_idx" ON "live"."notifications" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_account_idx" ON "live"."notifications" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_book_idx" ON "live"."orders" USING btree ("item","side","status","price");--> statement-breakpoint
CREATE UNIQUE INDEX "pickups_code_idx" ON "live"."pickups" USING btree ("code");--> statement-breakpoint
CREATE INDEX "pickups_seller_idx" ON "live"."pickups" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "pickups_buyer_idx" ON "live"."pickups" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "sanctions_company_idx" ON "live"."sanctions" USING btree ("company_id","until");--> statement-breakpoint
CREATE INDEX "trades_item_idx" ON "live"."trades" USING btree ("item","created_at");--> statement-breakpoint
CREATE INDEX "trades_buyer_idx" ON "live"."trades" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "trades_seller_idx" ON "live"."trades" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "union_members_union_idx" ON "live"."union_members" USING btree ("union_id");--> statement-breakpoint
CREATE INDEX "work_log_company_idx" ON "live"."work_log" USING btree ("company_id","created_at");