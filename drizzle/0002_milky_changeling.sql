CREATE TABLE "return_photos" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"return_id" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "branch" text;--> statement-breakpoint
ALTER TABLE "return_photos" ADD CONSTRAINT "return_photos_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "return_photos_return" ON "return_photos" USING btree ("return_id");