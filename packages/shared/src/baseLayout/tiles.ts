import type { TileType } from "./config.js";
import type { LayoutTile } from "./engine.js";

/**
 * Board classification (from the client's vector-tile read, see hexGrid.ts) -> tile type.
 * The classifier has no paved/garden-vs-yard signal yet: landcover (grass, wood, farmland)
 * maps to garden, anything unclassified to yard, and `paved` is only reachable via
 * future conversion. Kept here so the migration backfill and create-player agree.
 */
const TILE_TYPE_BY_CLASSIFICATION: Record<string, TileType> = {
  building: "indoor",
  water: "water",
  road: "road",
  landcover: "garden",
  empty: "yard",
};

export function tileTypeForClassification(classification: string): TileType {
  return TILE_TYPE_BY_CLASSIFICATION[classification] ?? "yard";
}

export function tilesFromHexGrid(grid: { cells: { q: number; r: number; classification: string }[] }): LayoutTile[] {
  return grid.cells.map((c) => ({ q: c.q, r: c.r, tileType: tileTypeForClassification(c.classification) }));
}
