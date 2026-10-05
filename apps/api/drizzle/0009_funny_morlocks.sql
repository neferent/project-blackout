CREATE TABLE IF NOT EXISTS "area_danger_cell_buildings" (
	"cell" text PRIMARY KEY NOT NULL,
	"buildings" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
