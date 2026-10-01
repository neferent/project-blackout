CREATE TABLE IF NOT EXISTS "power_plants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"osm_type" text NOT NULL,
	"osm_id" text NOT NULL,
	"name" text,
	"position" geometry(Point, 4326),
	"footprint" geometry(MultiPolygon, 4326),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "power_substations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"osm_type" text NOT NULL,
	"osm_id" text NOT NULL,
	"name" text,
	"position" geometry(Point, 4326),
	"footprint" geometry(MultiPolygon, 4326),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"osm_id" text NOT NULL,
	"highway" text NOT NULL,
	"name" text,
	"line" geometry(LineString, 4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roads_osm_id_unique" UNIQUE("osm_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "power_plants_osm_unique" ON "power_plants" USING btree ("osm_type","osm_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "power_plants_position_idx" ON "power_plants" USING gist ("position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "power_plants_footprint_idx" ON "power_plants" USING gist ("footprint");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "power_substations_osm_unique" ON "power_substations" USING btree ("osm_type","osm_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "power_substations_position_idx" ON "power_substations" USING gist ("position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "power_substations_footprint_idx" ON "power_substations" USING gist ("footprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roads_line_idx" ON "roads" USING gist ("line");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roads_highway_idx" ON "roads" USING btree ("highway");