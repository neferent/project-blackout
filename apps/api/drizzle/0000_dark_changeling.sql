CREATE TABLE IF NOT EXISTS "actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"route" geometry(LineString, 4326),
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anon_key" text NOT NULL,
	"position" geometry(Point, 4326) NOT NULL,
	"current_h3_cell" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_anon_key_unique" UNIQUE("anon_key")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "actions" ADD CONSTRAINT "actions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
