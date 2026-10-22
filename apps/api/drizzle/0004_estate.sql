CREATE TABLE "live"."plots" (
	"id" text PRIMARY KEY NOT NULL,
	"gx" integer NOT NULL,
	"gy" integer NOT NULL,
	"owner_id" text,
	"name" text DEFAULT '' NOT NULL,
	"blocks" jsonb NOT NULL,
	"for_sale" boolean DEFAULT false NOT NULL,
	"ask_price" integer,
	"bought_for" integer,
	"bought_at" bigint,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "plots_owner_idx" ON "live"."plots" USING btree ("owner_id");