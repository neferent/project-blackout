CREATE TABLE IF NOT EXISTS "area_danger_fetched_tiles" (
	"tile_key" text PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "area_danger_tiers" (
	"cell" text PRIMARY KEY NOT NULL,
	"tier" text NOT NULL,
	"position" geometry(Point, 4326) NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "area_danger_tiers_position_idx" ON "area_danger_tiers" USING gist ("position");