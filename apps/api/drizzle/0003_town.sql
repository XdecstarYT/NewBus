CREATE TABLE "live"."auctions" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text,
	"item" text NOT NULL,
	"qty" integer NOT NULL,
	"start_price" integer NOT NULL,
	"top_bid" integer,
	"top_bidder_id" text,
	"bids" integer DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"ends_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live"."loans" (
	"id" text PRIMARY KEY NOT NULL,
	"side" text NOT NULL,
	"lender_id" text,
	"borrower_id" text,
	"offered_to" text,
	"amount" integer NOT NULL,
	"interest_pct" integer NOT NULL,
	"days" integer NOT NULL,
	"owed" integer NOT NULL,
	"repaid" integer DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"accept_by" bigint NOT NULL,
	"due_at" bigint,
	"done_at" bigint
);
--> statement-breakpoint
CREATE TABLE "live"."project_contribs" (
	"project_id" text NOT NULL,
	"company_id" text NOT NULL,
	"bits" integer DEFAULT 0 NOT NULL,
	"items" jsonb NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "project_contribs_project_id_company_id_pk" PRIMARY KEY("project_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "live"."projects" (
	"id" text PRIMARY KEY NOT NULL,
	"blueprint" text NOT NULL,
	"title" text NOT NULL,
	"emoji" text NOT NULL,
	"blurb" text NOT NULL,
	"need_bits" integer NOT NULL,
	"need_items" jsonb NOT NULL,
	"have_bits" integer DEFAULT 0 NOT NULL,
	"have_items" jsonb NOT NULL,
	"boost" jsonb NOT NULL,
	"days" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"deadline" bigint NOT NULL,
	"done_at" bigint
);
--> statement-breakpoint
CREATE INDEX "auctions_status_idx" ON "live"."auctions" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "loans_status_idx" ON "live"."loans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "loans_lender_idx" ON "live"."loans" USING btree ("lender_id");--> statement-breakpoint
CREATE INDEX "loans_borrower_idx" ON "live"."loans" USING btree ("borrower_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "live"."projects" USING btree ("status");