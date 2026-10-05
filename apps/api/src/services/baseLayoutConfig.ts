import { getItemDef, SEED_BASE_LAYOUT_CONFIG, type BaseLayoutConfig } from "@blackout/shared";

/**
 * Single seam for the active base-layout rule config. Today it's the seed; swapping in
 * a DB- or file-backed config later changes only this function.
 */
export function getBaseLayoutConfig(): BaseLayoutConfig {
  return SEED_BASE_LAYOUT_CONFIG;
}

/** Kind for a placements row, derived from the item's definition (never client-supplied). */
export function placementKind(definitionId: string): string {
  const def = getItemDef(getBaseLayoutConfig(), definitionId);
  if (!def) throw new Error(`Unknown item definition "${definitionId}"`);
  return def.kind;
}
