CREATE TABLE IF NOT EXISTS "danger_zone_buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"outline" jsonb NOT NULL,
	"height" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "danger_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"polygon" geometry(Polygon, 4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "danger_zone_buildings" ADD CONSTRAINT "danger_zone_buildings_zone_id_danger_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."danger_zones"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "danger_zone_buildings_zone_idx" ON "danger_zone_buildings" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "danger_zones_polygon_idx" ON "danger_zones" USING gist ("polygon");