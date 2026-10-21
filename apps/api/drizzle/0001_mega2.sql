CREATE TABLE "live"."contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"buyer_id" text NOT NULL,
	"seller_id" text,
	"offered_to" text,
	"item" text NOT NULL,
	"qty" integer NOT NULL,
	"price" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"accept_by" bigint NOT NULL,
	"deliver_by" bigint NOT NULL,
	"accepted_at" bigint,
	"done_at" bigint
);
--> statement-breakpoint
CREATE TABLE "live"."customer_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"emoji" text NOT NULL,
	"persona" text DEFAULT '' NOT NULL,
	"message" text NOT NULL,
	"lines" jsonb NOT NULL,
	"pay" integer NOT NULL,
	"status" text NOT NULL,
	"filled_by" text,
	"haggled_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_written" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"filled_at" bigint
);
--> statement-breakpoint
CREATE TABLE "live"."jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"task" jsonb NOT NULL,
	"client_name" text NOT NULL,
	"client_emoji" text NOT NULL,
	"client_note" text DEFAULT '' NOT NULL,
	"reward" integer NOT NULL,
	"slots" integer NOT NULL,
	"taken" integer DEFAULT 0 NOT NULL,
	"target_company_id" text,
	"status" text NOT NULL,
	"posted_by" text NOT NULL,
	"funded" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live"."quests" (
	"account_id" text NOT NULL,
	"day" text NOT NULL,
	"quest_id" text NOT NULL,
	"kind" text NOT NULL,
	"target" integer NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"claimed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "quests_account_id_day_quest_id_pk" PRIMARY KEY("account_id","day","quest_id")
);
--> statement-breakpoint
CREATE TABLE "live"."submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"account_id" text NOT NULL,
	"company_id" text NOT NULL,
	"answers" jsonb,
	"status" text NOT NULL,
	"score" integer,
	"feedback" text,
	"results" jsonb,
	"payout" integer DEFAULT 0 NOT NULL,
	"graded_by" text,
	"started_at" bigint NOT NULL,
	"due_at" bigint NOT NULL,
	"submitted_at" bigint,
	"graded_at" bigint
);
--> statement-breakpoint
CREATE TABLE "live"."work_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"emoji" text NOT NULL,
	"brief" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"fields" jsonb NOT NULL,
	"grading" text NOT NULL,
	"answers" jsonb,
	"rubric" text DEFAULT '' NOT NULL,
	"reward" integer NOT NULL,
	"energy" integer NOT NULL,
	"minutes" integer NOT NULL,
	"difficulty" integer DEFAULT 1 NOT NULL,
	"source" text DEFAULT 'owner' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "contracts_status_idx" ON "live"."contracts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contracts_buyer_idx" ON "live"."contracts" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "contracts_seller_idx" ON "live"."contracts" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "customer_orders_status_idx" ON "live"."customer_orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "live"."jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "submissions_job_idx" ON "live"."submissions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "submissions_account_idx" ON "live"."submissions" USING btree ("account_id","started_at");--> statement-breakpoint
CREATE INDEX "submissions_status_idx" ON "live"."submissions" USING btree ("status");