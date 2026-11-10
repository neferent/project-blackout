ALTER TABLE "base_tiles" ADD COLUMN "designation" text;--> statement-breakpoint
-- Cached layout evaluations predate the walkway reachability rule; drop them so they recompute.
UPDATE "bases" SET "layout_efficiency" = NULL;
