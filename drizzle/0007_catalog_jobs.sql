CREATE TABLE "catalog_files" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"job_id" text NOT NULL,
	"role" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"data" text NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_jobs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"stores" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"file_name" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"plan" jsonb,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"parent_id" text,
	"created_by" text,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "catalog_files_job" ON "catalog_files" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "catalog_jobs_created" ON "catalog_jobs" USING btree ("created_at");