CREATE TABLE "branch_stock" (
	"barcode" text NOT NULL,
	"account" text NOT NULL,
	"store_code" text NOT NULL,
	"store_name" text,
	"qty" integer NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_stock_barcode_account_store_code_pk" PRIMARY KEY("barcode","account","store_code")
);
--> statement-breakpoint
CREATE TABLE "makers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"country" text DEFAULT 'EG' NOT NULL,
	"city" text,
	"contact_name" text,
	"phone" text,
	"email" text,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capacity" integer,
	"lead_days" integer,
	"payment_terms" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_orders" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"number" text NOT NULL,
	"maker_id" text NOT NULL,
	"brand" text NOT NULL,
	"market" text NOT NULL,
	"season" text,
	"style_code" text NOT NULL,
	"title" text NOT NULL,
	"category" text,
	"colour" text,
	"image" text,
	"sizes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"costs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retail_price" bigint,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stage" text DEFAULT 'brief' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"due_at" date,
	"inspections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"received" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"product_id" text,
	"note" text,
	"created_by" text,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_orders_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "web_items" (
	"channel_id" text NOT NULL,
	"barcode" text NOT NULL,
	"sku" text,
	"product_id" text,
	"variant_id" text,
	"handle" text,
	"title" text,
	"brand" text,
	"size" text,
	"product_type" text,
	"status" text NOT NULL,
	"has_photo" boolean,
	"has_description" boolean,
	"has_category" boolean,
	"price" bigint,
	"compare_at" bigint,
	"web_qty" integer,
	"lucida_qty" integer,
	"lucida_price" bigint,
	"lucida_was" bigint,
	"lucida_db" text,
	"lucida_desc" text,
	"currency" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lucida_at" timestamp with time zone,
	CONSTRAINT "web_items_channel_id_barcode_pk" PRIMARY KEY("channel_id","barcode")
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "brands" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ship_from" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ship_from_name" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ship_from_by" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ship_from_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "returns" ADD COLUMN "review" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "brands" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "branch_stock_barcode" ON "branch_stock" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "production_status" ON "production_orders" USING btree ("status","stage");--> statement-breakpoint
CREATE INDEX "production_maker" ON "production_orders" USING btree ("maker_id");--> statement-breakpoint
CREATE INDEX "production_brand" ON "production_orders" USING btree ("brand");--> statement-breakpoint
CREATE INDEX "web_items_status" ON "web_items" USING btree ("channel_id","status");--> statement-breakpoint
CREATE INDEX "web_items_brand" ON "web_items" USING btree ("brand");