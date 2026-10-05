CREATE TABLE IF NOT EXISTS "bases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"hex_cell" text NOT NULL,
	"radius" integer NOT NULL,
	"grid_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bases_player_id_unique" UNIQUE("player_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bases" ADD CONSTRAINT "bases_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
