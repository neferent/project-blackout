ALTER TABLE "players" ADD COLUMN "base_h3_cell" text NOT NULL;--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN IF EXISTS "base_lat";--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN IF EXISTS "base_lng";