import { z } from "zod";

export const TILE_TYPES = ["indoor", "yard", "garden", "paved", "water", "road"] as const;
export const tileTypeSchema = z.enum(TILE_TYPES);
export type TileType = z.infer<typeof tileTypeSchema>;

export const itemKindSchema = z.enum(["station", "attachment", "door"]);
export type ItemKind = z.infer<typeof itemKindSchema>;

const facing = z.number().int().min(0).max(5);

/** Static definition of a placeable item type. Instances (quality, owner) live in the DB. */
export const itemDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: itemKindSchema,
  /** Tile types this item may sit on. Roads/water are simply never listed. */
  slots: z.array(tileTypeSchema).min(1),
  /** Free-form tags that rules can match with "#tag". */
  tags: z.array(z.string()).default([]),
  weight: z.number().nonnegative().default(1),
  size: z.number().nonnegative().default(1),
  /** Game hours to place a new instance from inventory. */
  placeHours: z.number().nonnegative().default(0.5),
  /** Flat game hours added when an already-placed item is moved. */
  moveBaseHours: z.number().nonnegative().default(0.1),
  /** Stations: capabilities the station provides to itself. */
  capabilities: z.array(z.string()).default([]),
  /** Attachments: capabilities granted to an adjacent station. */
  grants: z.array(z.string()).default([]),
  /**
   * Attachments: station-relative sides (0..5, relative to the station's facing) the
   * attachment must sit on to grant. Omitted = any side.
   */
  sides: z.array(facing).optional(),
  /** Bonus when placed on an indoor tile that borders a non-indoor tile or the board edge. */
  daylightBonus: z.number().nonnegative().optional(),
});
export type ItemDef = z.infer<typeof itemDefSchema>;

/**
 * Pair rule: `a`/`b` match an item id, or "#tag". `adjacent` rules are binary (distance 1);
 * `range` rules give the full bonus within `range`, taper linearly to 0 over `falloff`
 * further tiles, then apply `farPenalty` beyond that.
 */
export const synergyRuleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  a: z.string().min(1),
  b: z.string().min(1),
  mode: z.enum(["adjacent", "range"]),
  range: z.number().int().positive().default(1),
  falloff: z.number().int().nonnegative().default(0),
  /** Fraction of time saved, e.g. 0.12 = -12% game hours. */
  bonus: z.number().nonnegative(),
  farPenalty: z.number().nonnegative().default(0),
  /** Which side(s) of the pair receive the effect. */
  applies: z.enum(["a", "b", "both"]).default("both"),
});
export type SynergyRule = z.infer<typeof synergyRuleSchema>;

export const hazardRuleSchema = z.object({
  id: z.string().min(1),
  a: z.string().min(1),
  b: z.string().min(1),
  /** Hazard triggers when hex distance <= within. */
  within: z.number().int().positive(),
  penalty: z.number().nonnegative(),
  message: z.string().min(1),
});
export type HazardRule = z.infer<typeof hazardRuleSchema>;

export const baseLayoutConfigSchema = z.object({
  version: z.number().int().positive(),
  /** Cap on the summed positive bonus per station (0.25 = at most -25% time). */
  bonusCap: z.number().min(0).max(1).default(0.25),
  /** Floor on the net bonus per station (penalties can't push worse than -maxPenalty). */
  maxPenalty: z.number().min(0).max(1).default(0.5),
  /** Quality 0..100 maps linearly onto this multiplier on positive bonuses. */
  quality: z.object({ min: z.number().positive(), max: z.number().positive() }).default({ min: 0.5, max: 1.5 }),
  /** Penalty for a station whose front tile can't be reached from the door. */
  unreachablePenalty: z.number().nonnegative().default(0.1),
  /** Game hours for a pure rotation of a placed item. */
  rotateHours: z.number().nonnegative().default(0.1),
  /** Move cost = moveBaseHours + weight * size * hexDistance * moveHoursPerUnit. */
  moveHoursPerUnit: z.number().nonnegative().default(0.05),
  items: z.array(itemDefSchema).min(1),
  synergies: z.array(synergyRuleSchema).default([]),
  hazards: z.array(hazardRuleSchema).default([]),
});
export type BaseLayoutConfig = z.infer<typeof baseLayoutConfigSchema>;
export type BaseLayoutConfigInput = z.input<typeof baseLayoutConfigSchema>;

/** Player-facing stub for a future "saved/shared layouts" feature. Not implemented. */
export interface SavedLayoutStub {
  id: string;
  name: string;
  placements: { definitionId: string; q: number; r: number; facing: number }[];
}
