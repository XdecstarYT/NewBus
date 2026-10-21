CREATE TABLE "live"."owner_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"item" text,
	"qty" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"ai_written" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"due_at" bigint NOT NULL,
	"done_at" bigint
);
--> statement-breakpoint
CREATE INDEX "owner_requests_company_idx" ON "live"."owner_requests" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "owner_requests_status_idx" ON "live"."owner_requests" USING btree ("status");