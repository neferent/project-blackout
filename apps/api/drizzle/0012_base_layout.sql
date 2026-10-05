CREATE TABLE IF NOT EXISTS "base_tiles" (
	"base_id" uuid NOT NULL,
	"q" integer NOT NULL,
	"r" integer NOT NULL,
	"tile_type" text NOT NULL,
	"converted_from" text,
	CONSTRAINT "base_tiles_base_id_q_r_pk" PRIMARY KEY("base_id","q","r")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_player_id" uuid NOT NULL,
	"definition_id" text NOT NULL,
	"quality" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"q" integer NOT NULL,
	"r" integer NOT NULL,
	"facing" integer NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "placements_item_id_unique" UNIQUE("item_id")
);
--> statement-breakpoint
ALTER TABLE "bases" ADD COLUMN "layout_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bases" ADD COLUMN "layout_efficiency" jsonb;--> statement-breakpoint
ALTER TABLE "bases" ADD COLUMN "starter_kit_granted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "base_tiles" ADD CONSTRAINT "base_tiles_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "items" ADD CONSTRAINT "items_owner_player_id_players_id_fk" FOREIGN KEY ("owner_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "placements" ADD CONSTRAINT "placements_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "placements" ADD CONSTRAINT "placements_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "placements_base_tile_unique" ON "placements" USING btree ("base_id","q","r");--> statement-breakpoint
-- Backfill typed tiles for existing bases. Mirrors tileTypeForClassification in
-- packages/shared/src/baseLayout/tiles.ts (building->indoor, landcover->garden, empty/unknown->yard).
INSERT INTO "base_tiles" ("base_id", "q", "r", "tile_type")
SELECT b."id",
       (cell->>'q')::int,
       (cell->>'r')::int,
       CASE cell->>'classification'
         WHEN 'building' THEN 'indoor'
         WHEN 'water' THEN 'water'
         WHEN 'road' THEN 'road'
         WHEN 'landcover' THEN 'garden'
         ELSE 'yard'
       END
FROM "bases" b, jsonb_array_elements(b."grid_data"->'cells') AS cell
ON CONFLICT DO NOTHING;
