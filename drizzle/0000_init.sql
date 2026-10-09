CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'demo' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_ok" boolean,
	"last_sync_note" text,
	"cursor" text,
	"last_webhook_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"phone" text,
	"email" text,
	"name" text NOT NULL,
	"city" text,
	"region" text,
	"country" text NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"refused" integer DEFAULT 0 NOT NULL,
	"returned" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"vip" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dismissals" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" text,
	"return_id" text,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"dept" text,
	"kind" text NOT NULL,
	"from_stage" text,
	"to_stage" text,
	"message" text NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"order_id" text NOT NULL,
	"sku" text,
	"barcode" text,
	"title" text NOT NULL,
	"variant" text,
	"size" text,
	"brand" text,
	"category" text,
	"image" text,
	"quantity" integer NOT NULL,
	"unit_price" bigint NOT NULL,
	"picked" integer DEFAULT 0 NOT NULL,
	"returnable" boolean DEFAULT true NOT NULL,
	"stock_hint" integer
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"channel_id" text NOT NULL,
	"external_id" text NOT NULL,
	"number" text NOT NULL,
	"source" text DEFAULT 'demo' NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"customer_id" text,
	"customer_name" text NOT NULL,
	"phone" text,
	"email" text,
	"address" jsonb,
	"currency" text NOT NULL,
	"subtotal" bigint NOT NULL,
	"shipping" bigint DEFAULT 0 NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"payment_method" text NOT NULL,
	"payment_status" text NOT NULL,
	"stage" text NOT NULL,
	"stage_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone,
	"on_hold" boolean DEFAULT false NOT NULL,
	"hold_reason" text,
	"exception" text,
	"risk" integer DEFAULT 0 NOT NULL,
	"risk_level" text DEFAULT 'low' NOT NULL,
	"risk_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"autopilot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assignee_id" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"items" integer DEFAULT 0 NOT NULL,
	"courier" text,
	"tracking" text,
	"tracking_url" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"settlement_id" text,
	"note" text,
	"confirmed_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"packed_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cancel_reason" text,
	"synced_at" timestamp with time zone,
	"write_back" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_items" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"return_id" text NOT NULL,
	"order_item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"reason" text,
	"condition" text
);
--> statement-breakpoint
CREATE TABLE "returns" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"number" text NOT NULL,
	"order_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"customer_id" text,
	"requested_at" timestamp with time zone NOT NULL,
	"stage" text NOT NULL,
	"stage_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone,
	"reason" text NOT NULL,
	"reason_note" text,
	"resolution" text DEFAULT 'refund' NOT NULL,
	"method" text DEFAULT 'pickup' NOT NULL,
	"currency" text NOT NULL,
	"amount" bigint NOT NULL,
	"inspection" text,
	"restocked" boolean DEFAULT false NOT NULL,
	"tracking" text,
	"assignee_id" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "returns_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"reference" text NOT NULL,
	"courier" text NOT NULL,
	"currency" text NOT NULL,
	"period_from" timestamp with time zone NOT NULL,
	"period_to" timestamp with time zone NOT NULL,
	"expected" bigint NOT NULL,
	"remitted" bigint,
	"order_count" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"matched_at" timestamp with time zone,
	CONSTRAINT "settlements_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "stock_signals" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"sku" text NOT NULL,
	"title" text,
	"on_hand" integer,
	"demand" integer NOT NULL,
	"channels" jsonb NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"channel_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"fetched" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"password_hash" text,
	"role" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"hue" integer DEFAULT 200 NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_phone" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "customers_email" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "dismissals_pk" ON "dismissals" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "events_order" ON "events" USING btree ("order_id","at");--> statement-breakpoint
CREATE INDEX "events_return" ON "events" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "events_at" ON "events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "items_order" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "items_sku" ON "order_items" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_channel_ext" ON "orders" USING btree ("channel_id","external_id");--> statement-breakpoint
CREATE INDEX "orders_stage" ON "orders" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "orders_placed" ON "orders" USING btree ("placed_at");--> statement-breakpoint
CREATE INDEX "orders_customer" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_number" ON "orders" USING btree ("number");--> statement-breakpoint
CREATE INDEX "returns_stage" ON "returns" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "returns_order" ON "returns" USING btree ("order_id");