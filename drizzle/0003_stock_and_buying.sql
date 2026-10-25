CREATE TABLE "activity" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"area" text NOT NULL,
	"kind" text NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"message" text NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"company" text NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"city" text,
	"area" text,
	"brands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"phone" text,
	"external_code" text,
	"active" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'demo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "placement_daily" (
	"placement_id" text NOT NULL,
	"day" date NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"adds" integer DEFAULT 0 NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"revenue" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "placement_daily_placement_id_day_pk" PRIMARY KEY("placement_id","day")
);
--> statement-breakpoint
CREATE TABLE "placements" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"market" text NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"anchors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"headline" text NOT NULL,
	"headline_ar" text,
	"body" text,
	"offer" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"recommendation_id" text,
	"created_by" text,
	"created_by_name" text NOT NULL,
	"approved_by" text,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "placements_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "po_lines" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"po_id" text NOT NULL,
	"product_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"qty" integer NOT NULL,
	"received" integer DEFAULT 0 NOT NULL,
	"damaged" integer DEFAULT 0 NOT NULL,
	"unit_cost" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"market" text NOT NULL,
	"company" text NOT NULL,
	"style_code" text NOT NULL,
	"title" text NOT NULL,
	"brand" text NOT NULL,
	"category" text NOT NULL,
	"season" text DEFAULT 'core' NOT NULL,
	"image" text,
	"currency" text NOT NULL,
	"price" bigint NOT NULL,
	"cost" bigint NOT NULL,
	"compare_at" bigint,
	"sizes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"size_mix" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"supplier_id" text,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"handle" text,
	"status" text DEFAULT 'active' NOT NULL,
	"launched_at" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'demo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"number" text NOT NULL,
	"supplier_id" text NOT NULL,
	"location_id" text NOT NULL,
	"company" text NOT NULL,
	"market" text NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"season" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"reason" text,
	"note" text,
	"expected_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" text,
	"created_by_name" text NOT NULL,
	"approved_by" text,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"area" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"market" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"impact" bigint DEFAULT 0 NOT NULL,
	"impact_label" text,
	"confidence" integer DEFAULT 70 NOT NULL,
	"priority" integer DEFAULT 3 NOT NULL,
	"product_id" text,
	"location_id" text,
	"supplier_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"result_ref" text,
	CONSTRAINT "recommendations_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sales_weekly" (
	"week" date NOT NULL,
	"product_id" text NOT NULL,
	"location_id" text NOT NULL,
	"units" integer NOT NULL,
	"revenue" bigint NOT NULL,
	"cost" bigint NOT NULL,
	"stockout_days" integer DEFAULT 0 NOT NULL,
	"markdown_units" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sales_weekly_week_product_id_location_id_pk" PRIMARY KEY("week","product_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "stock_levels" (
	"variant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"location_id" text NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"bin" text,
	"counted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_levels_variant_id_location_id_pk" PRIMARY KEY("variant_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "stock_moves" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"variant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"location_id" text NOT NULL,
	"qty" integer NOT NULL,
	"kind" text NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"channel_id" text,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"brands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lead_days" integer NOT NULL,
	"moq" integer DEFAULT 0 NOT NULL,
	"case_pack" integer DEFAULT 1 NOT NULL,
	"payment_terms" text,
	"contact_name" text,
	"contact_email" text,
	"phone" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'demo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"area" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"location_id" text,
	"assignee_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" integer DEFAULT 3 NOT NULL,
	"due_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"est_minutes" integer DEFAULT 15 NOT NULL,
	"spent_minutes" integer,
	"units" integer DEFAULT 0 NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"blocked_reason" text,
	"result" jsonb,
	"created_by" text,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "transfer_lines" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"transfer_id" text NOT NULL,
	"product_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"qty" integer NOT NULL,
	"received" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"number" text NOT NULL,
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"status" text NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by" text,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"shipped_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	CONSTRAINT "transfers_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "variants" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"product_id" text NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"size" text,
	"size_idx" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "custom" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "config" jsonb;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "created_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "shift_start" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "shift_end" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "rest_days" jsonb DEFAULT '[5]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "skills" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "placement_daily" ADD CONSTRAINT "placement_daily_placement_id_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."placements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_at" ON "activity" USING btree ("at");--> statement-breakpoint
CREATE INDEX "activity_actor" ON "activity" USING btree ("actor_id","at");--> statement-breakpoint
CREATE INDEX "activity_ref" ON "activity" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "placements_status" ON "placements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "po_lines_po" ON "po_lines" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "po_lines_product" ON "po_lines" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_market_style" ON "products" USING btree ("market","style_code");--> statement-breakpoint
CREATE INDEX "products_brand" ON "products" USING btree ("brand");--> statement-breakpoint
CREATE INDEX "products_category" ON "products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "po_status" ON "purchase_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "po_supplier" ON "purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "recs_status" ON "recommendations" USING btree ("status","area");--> statement-breakpoint
CREATE INDEX "recs_product" ON "recommendations" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sales_weekly_product" ON "sales_weekly" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sales_weekly_week" ON "sales_weekly" USING btree ("week");--> statement-breakpoint
CREATE INDEX "stock_levels_location" ON "stock_levels" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "stock_levels_product" ON "stock_levels" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "stock_moves_product" ON "stock_moves" USING btree ("product_id","at");--> statement-breakpoint
CREATE INDEX "stock_moves_location" ON "stock_moves" USING btree ("location_id","at");--> statement-breakpoint
CREATE INDEX "stock_moves_at" ON "stock_moves" USING btree ("at");--> statement-breakpoint
CREATE INDEX "tasks_assignee" ON "tasks" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "tasks_status" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_done" ON "tasks" USING btree ("done_at");--> statement-breakpoint
CREATE INDEX "tasks_ref" ON "tasks" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "transfer_lines_transfer" ON "transfer_lines" USING btree ("transfer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_product_sku" ON "variants" USING btree ("product_id","sku");--> statement-breakpoint
CREATE INDEX "variants_sku" ON "variants" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "variants_barcode" ON "variants" USING btree ("barcode");