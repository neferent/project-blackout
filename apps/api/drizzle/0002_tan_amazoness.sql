CREATE TABLE IF NOT EXISTS "building_lookups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"osm_type" text NOT NULL,
	"osm_id" text NOT NULL,
	"name" text,
	"shop" text,
	"amenity" text,
	"building" text,
	"outline" geometry(MultiPolygon, 4326) NOT NULL,
	"contains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "building_lookups_osm_unique" ON "building_lookups" USING btree ("osm_type","osm_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "building_lookups_outline_idx" ON "building_lookups" USING gist ("outline");