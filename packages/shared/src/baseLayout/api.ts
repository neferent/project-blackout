import { z } from "zod";
import type { LayoutEvaluation, LayoutItemInstance, LayoutPlacement, LayoutTile } from "./engine.js";
import { designationSchema, type TileType } from "./config.js";

export const layoutPlacementSchema = z.object({
  itemId: z.string().uuid(),
  q: z.number().int(),
  r: z.number().int(),
  facing: z.number().int().min(0).max(5),
});

/**
 * POST /base/layout/commit. The client sends the full target layout plus the layout
 * version it planned against; the server derives the diff itself and never trusts a
 * client-supplied cost or duration.
 */
export const tileDesignationSchema = z.object({
  q: z.number().int(),
  r: z.number().int(),
  designation: designationSchema,
});

export const commitLayoutRequestSchema = z.object({
  baseVersion: z.number().int().nonnegative(),
  placements: z.array(layoutPlacementSchema).max(500),
  /** Full target set of designated tiles. Omitted = leave designations as they are. */
  designations: z.array(tileDesignationSchema).max(500).optional(),
});
export type CommitLayoutRequest = z.infer<typeof commitLayoutRequestSchema>;

/** `data` of a "layout" action. Duration is the server-computed diff cost. */
export const layoutActionDataSchema = z.object({
  baseId: z.string().uuid(),
  /** Layout version this action was planned against; applied when it finalizes. */
  baseVersion: z.number().int().nonnegative(),
  /** The full layout that becomes committed when the action ends. */
  placements: z.array(layoutPlacementSchema),
  /** Target designated tiles; absent (older actions) = designations unchanged. */
  designations: z.array(tileDesignationSchema).optional(),
  hours: z.number().nonnegative(),
  gameSeconds: z.number().nonnegative(),
});
export type LayoutActionData = z.infer<typeof layoutActionDataSchema>;

export interface ActiveLayoutAction {
  id: string;
  startsAt: string;
  endsAt: string;
  hours: number;
  /** The layout that will apply when it finishes. */
  placements: LayoutPlacement[];
  designations?: z.infer<typeof tileDesignationSchema>[];
}

/** Response of GET /base: everything the client needs to render and plan a layout. */
export interface BaseLayoutState {
  baseId: string;
  layoutVersion: number;
  tiles: (LayoutTile & { convertedFrom: TileType | null })[];
  /** Currently committed placements (the old layout while an action runs). */
  placements: LayoutPlacement[];
  /** Every item instance the player owns, placed or not, keyed by item id. */
  items: Record<string, LayoutItemInstance>;
  /** Cached evaluation of the committed layout. */
  evaluation: LayoutEvaluation;
  /** While set, the base is locked: nothing is usable and no new commit may start. */
  activeLayoutAction: ActiveLayoutAction | null;
}
