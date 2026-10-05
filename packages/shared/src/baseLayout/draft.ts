import type { BaseLayoutConfig } from "./config.js";
import { getItemDef, type LayoutItemInstance, type LayoutPlacement, type LayoutTile } from "./engine.js";
import { hexKey, hexNeighbor, normalizeFacing, type Axial } from "./hex.js";

/**
 * Pure plan-mode edits. The client applies these to its draft (free, no server round
 * trip); the server re-validates the final layout with validateLayout on commit.
 */
export type DraftResult = { ok: true; placements: LayoutPlacement[] } | { ok: false; message: string };

/**
 * First facing whose front tile is on the board, not water and unoccupied — so a freshly
 * placed station starts out with the open front tile it needs. Falls back to 0.
 */
export function defaultFacing(tiles: LayoutTile[], placements: LayoutPlacement[], at: Axial): number {
  const tileByKey = new Map(tiles.map((t) => [hexKey(t.q, t.r), t]));
  const taken = new Set(placements.map((p) => hexKey(p.q, p.r)));
  for (let facing = 0; facing < 6; facing++) {
    const front = hexNeighbor(at, facing);
    const key = hexKey(front.q, front.r);
    const tile = tileByKey.get(key);
    if (tile && tile.tileType !== "water" && !taken.has(key)) return facing;
  }
  return 0;
}

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
  const occupant = args.placements.find((p) => p.q === at.q && p.r === at.r);
  if (occupant && occupant.itemId !== itemId) return { ok: false, message: "That tile is taken" };

  const without = args.placements.filter((p) => p.itemId !== itemId);
  const existing = args.placements.find((p) => p.itemId === itemId);
  const nextFacing =
    facing !== undefined
      ? normalizeFacing(facing)
      : (existing?.facing ?? (def.kind === "station" ? defaultFacing(args.tiles, without, at) : 0));
  return { ok: true, placements: [...without, { itemId, q: at.q, r: at.r, facing: nextFacing }] };
}

export function rotatePlacement(placements: LayoutPlacement[], itemId: string, steps = 1): LayoutPlacement[] {
  return placements.map((p) => (p.itemId === itemId ? { ...p, facing: normalizeFacing(p.facing + steps) } : p));
}

export function removePlacement(placements: LayoutPlacement[], itemId: string): LayoutPlacement[] {
  return placements.filter((p) => p.itemId !== itemId);
}

/** Tiles an item could legally be dropped on right now (slot fits, tile free or its own). */
export function validDropTiles(
  config: BaseLayoutConfig,
  args: { tiles: LayoutTile[]; items: Record<string, LayoutItemInstance>; placements: LayoutPlacement[] },
  itemId: string,
): Axial[] {
  const def = args.items[itemId] && getItemDef(config, args.items[itemId].definitionId);
  if (!def) return [];
  const taken = new Map(args.placements.map((p) => [hexKey(p.q, p.r), p.itemId]));
  return args.tiles
    .filter((t) => def.slots.includes(t.tileType) && (!taken.has(hexKey(t.q, t.r)) || taken.get(hexKey(t.q, t.r)) === itemId))
    .map((t) => ({ q: t.q, r: t.r }));
}
