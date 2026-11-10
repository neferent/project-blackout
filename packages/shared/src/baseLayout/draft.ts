import type { BaseLayoutConfig, Designation } from "./config.js";
import {
  getItemDef,
  type LayoutItemInstance,
  type LayoutPlacement,
  type LayoutTile,
  type TileDesignation,
} from "./engine.js";
import { hexKey, normalizeFacing, type Axial } from "./hex.js";

/**
 * Pure plan-mode edits. The client applies these to its draft (free, no server round
 * trip); the server re-validates the final layout with validateLayout on commit.
 */
export type DraftResult = { ok: true; placements: LayoutPlacement[] } | { ok: false; message: string };

/** Place an unplaced item, or move an already-placed one, onto a tile. Never swaps or replaces. */
export function placeItem(
  config: BaseLayoutConfig,
  args: { tiles: LayoutTile[]; items: Record<string, LayoutItemInstance>; placements: LayoutPlacement[] },
  itemId: string,
  at: Axial,
  facing?: number,
): DraftResult {
  const instance = args.items[itemId];
  const def = instance && getItemDef(config, instance.definitionId);
  if (!def) return { ok: false, message: "Unknown item" };
  const tile = args.tiles.find((t) => t.q === at.q && t.r === at.r);
  if (!tile) return { ok: false, message: "That's off the board" };
  if (!def.slots.includes(tile.tileType)) {
    return { ok: false, message: `${def.name} can't go on a ${tile.tileType} tile` };
  }
  if (tile.designation) {
    return { ok: false, message: `That's a ${tile.designation} tile — clear it first` };
  }
  const occupant = args.placements.find((p) => p.q === at.q && p.r === at.r);
  if (occupant && occupant.itemId !== itemId) return { ok: false, message: "That tile is taken" };

  const without = args.placements.filter((p) => p.itemId !== itemId);
  const existing = args.placements.find((p) => p.itemId === itemId);
  // Facing is vestigial: items link by adjacency alone, so it stays 0 unless a caller sets it.
  const nextFacing = facing !== undefined ? normalizeFacing(facing) : (existing?.facing ?? 0);
  return { ok: true, placements: [...without, { itemId, q: at.q, r: at.r, facing: nextFacing }] };
}

export function removePlacement(placements: LayoutPlacement[], itemId: string): LayoutPlacement[] {
  return placements.filter((p) => p.itemId !== itemId);
}

/** Tiles an item could legally be dropped on right now (slot fits, not designated, tile free or its own). */
export function validDropTiles(
  config: BaseLayoutConfig,
  args: { tiles: LayoutTile[]; items: Record<string, LayoutItemInstance>; placements: LayoutPlacement[] },
  itemId: string,
): Axial[] {
  const def = args.items[itemId] && getItemDef(config, args.items[itemId].definitionId);
  if (!def) return [];
  const taken = new Map(args.placements.map((p) => [hexKey(p.q, p.r), p.itemId]));
  return args.tiles
    .filter(
      (t) =>
        !t.designation &&
        def.slots.includes(t.tileType) &&
        (!taken.has(hexKey(t.q, t.r)) || taken.get(hexKey(t.q, t.r)) === itemId),
    )
    .map((t) => ({ q: t.q, r: t.r }));
}

export type DesignationResult = { ok: true; designations: TileDesignation[] } | { ok: false; message: string };

/** Paint a tile walkway/clear, or pass null to erase. Refuses occupied, off-board and disallowed tiles. */
export function setTileDesignation(
  config: BaseLayoutConfig,
  args: { tiles: LayoutTile[]; placements: LayoutPlacement[]; designations: TileDesignation[] },
  at: Axial,
  designation: Designation | null,
): DesignationResult {
  const tile = args.tiles.find((t) => t.q === at.q && t.r === at.r);
  if (!tile) return { ok: false, message: "That's off the board" };
  const rest = args.designations.filter((d) => !(d.q === at.q && d.r === at.r));
  if (designation === null) return { ok: true, designations: rest };
  if (!config.designations.allowedTiles.includes(tile.tileType)) {
    return { ok: false, message: `A ${tile.tileType} tile can't be a ${designation}` };
  }
  if (args.placements.some((p) => p.q === at.q && p.r === at.r)) {
    return { ok: false, message: "Move the item off this tile first" };
  }
  return { ok: true, designations: [...rest, { q: at.q, r: at.r, designation }] };
}
