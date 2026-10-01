CREATE TABLE IF NOT EXISTS "power_infrastructure_fetched_tiles" (
	"tile_key" text PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "power_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"osm_id" text NOT NULL,
	"line" geometry(LineString, 4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "power_lines_osm_id_unique" UNIQUE("osm_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "power_towers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"osm_id" text NOT NULL,
	"position" geometry(Point, 4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "power_towers_osm_id_unique" UNIQUE("osm_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "power_lines_line_idx" ON "power_lines" USING gist ("line");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "power_towers_position_idx" ON "power_towers" USING gist ("position");