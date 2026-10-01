import { cellToLatLng } from "h3-js";
import { sql } from "drizzle-orm";
import type { LatLng } from "@blackout/shared";
import { db } from "../db/client.js";
import { buildingLookups, powerPlants, powerSubstations } from "../db/schema.js";
import { dangerFromDistanceMeters } from "./dangerMath.js";
import { findAllZonePolygons } from "./dangerZoneStore.js";

/**
 * Danger per H3 cell, fed into routing as avoid-zones/costs. Substations and
 * plants are the actual danger sources ("something lives in it" — see
 * project_power_grid_danger_system design notes); proximity to one makes a
 * cell dangerous, decaying to 0 by DANGER_FALLOFF_METERS. A disconnected
 * building (building_lookups.connected_to_grid = false, set by the
 * `disconnect` action) neutralizes danger in its immediate vicinity
 * regardless of how close a source is — that's the whole point of the
 * disconnect mechanic.
 */
export interface DangerProvider {
  dangerForCell(h3Cell: string): Promise<number>;
  /** Polygons (closed rings) routing should be able to route around. */
  dangerZones(): Promise<LatLng[][]>;
}

/** How far a disconnected building's safety extends around it. */
const DISCONNECTED_SAFE_RADIUS_METERS = 100;

function pointWkt(point: LatLng): ReturnType<typeof sql> {
  return sql`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)`;
}

async function nearestPowerSourceDistanceMeters(point: LatLng): Promise<number | null> {
  const geoPoint = pointWkt(point);
  const [row] = await db.execute<{ distance_m: number | null }>(sql`
    select min(distance_m) as distance_m from (
      select ST_Distance(coalesce(position, ST_Centroid(footprint))::geography, ${geoPoint}::geography) as distance_m
      from ${powerSubstations}
      union all
      select ST_Distance(coalesce(position, ST_Centroid(footprint))::geography, ${geoPoint}::geography) as distance_m
      from ${powerPlants}
    ) sources
  `);
  return row?.distance_m ?? null;
}

async function hasDisconnectedBuildingNearby(point: LatLng): Promise<boolean> {
  const [row] = await db.execute<{ nearby: boolean }>(sql`
    select exists(
      select 1 from ${buildingLookups}
      where connected_to_grid = false
      and ST_DWithin(outline::geography, ${pointWkt(point)}::geography, ${DISCONNECTED_SAFE_RADIUS_METERS})
    ) as nearby
  `);
  return row?.nearby ?? false;
}

export const dangerProvider: DangerProvider = {
  async dangerForCell(h3Cell: string): Promise<number> {
    const [lat, lng] = cellToLatLng(h3Cell);
    const point: LatLng = { lat, lng };

    if (await hasDisconnectedBuildingNearby(point)) return 0;

    const distanceM = await nearestPowerSourceDistanceMeters(point);
    if (distanceM === null) return 0;
    return dangerFromDistanceMeters(distanceM);
  },
  dangerZones: findAllZonePolygons,
};
