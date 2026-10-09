ALTER TABLE "returns" ADD COLUMN "refund_method" text DEFAULT 'original' NOT NULL;--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "bonus" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "opened_via" text DEFAULT 'agent' NOT NULL;