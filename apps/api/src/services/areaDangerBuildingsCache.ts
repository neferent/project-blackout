import { eq } from "drizzle-orm";
import { cellToBoundary } from "h3-js";
import type { BuildingInZone } from "@blackout/shared";
import { db } from "../db/client.js";
import { areaDangerCellBuildings } from "../db/schema.js";
import { queryOverpassBuildingsInZone } from "./overpass.js";

/**
 * Buildings within one AREA_H3_RESOLUTION cell — resolved from Overpass once
 * and persisted (areaDangerCellBuildings), never re-queried after. A cell's
 * tier can change (see dangerProvider.ts's invalidateAreaDangerCacheNear),
 * but which buildings physically sit in a given cell never does, so this
 * cache has no invalidation path — once resolved, always valid.
 */
export async function findOrFetchBuildingsInCell(cell: string): Promise<BuildingInZone[]> {
  const [cached] = await db
    .select({ buildings: areaDangerCellBuildings.buildings })
    .from(areaDangerCellBuildings)
    .where(eq(areaDangerCellBuildings.cell, cell));
  if (cached) return cached.buildings as BuildingInZone[];

  const boundary = cellToBoundary(cell, true).map(([lng, lat]) => ({ lat, lng }));
  const buildings = await queryOverpassBuildingsInZone(boundary, 0);

  await db.insert(areaDangerCellBuildings).values({ cell, buildings }).onConflictDoNothing();

  return buildings;
}
