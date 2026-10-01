import { sql } from "drizzle-orm";
import type { BuildingInZone, DangerZoneShape, LatLng } from "@blackout/shared";
import { db } from "../db/client.js";
import { dangerZoneBuildings, dangerZones } from "../db/schema.js";
import { generateDangerZone } from "./dangerZoneGenerator.js";
import { queryOverpassBuildingsInZone } from "./overpass.js";

function ringToWkt(ring: LatLng[]): string {
  return `POLYGON((${ring.map((p) => `${p.lng} ${p.lat}`).join(", ")}))`;
}

/**
 * Generates a new zone's shape around `center`, persists it, then resolves
 * and persists the buildings within `bufferMeters` of it (a single Overpass
 * call, at creation time only — never recomputed on read).
 */
export async function createDangerZone(
  center: LatLng,
  bufferMeters: number,
): Promise<DangerZoneShape & { buildingCount: number }> {
  const polygon = await generateDangerZone(center);

  const [inserted] = await db
    .insert(dangerZones)
    .values({ polygon: sql`ST_SetSRID(ST_GeomFromText(${ringToWkt(polygon)}), 4326)` })
    .returning({ id: dangerZones.id });

  const buildings = await queryOverpassBuildingsInZone(polygon, bufferMeters);
  if (buildings.length > 0) {
    await db.insert(dangerZoneBuildings).values(
      buildings.map((b) => ({
        zoneId: inserted.id,
        outline: b.outline,
        height: b.height ?? null,
      })),
    );
  }

  return { id: inserted.id, polygon, buildingCount: buildings.length };
}

interface ZoneRow extends Record<string, unknown> {
  id: string;
  polygon_geojson: string;
}

function rowToZoneShape(row: ZoneRow): DangerZoneShape {
  const geojson = JSON.parse(row.polygon_geojson) as { coordinates: [number, number][][] };
  return { id: row.id, polygon: geojson.coordinates[0].map(([lng, lat]) => ({ lat, lng })) };
}

/** Every zone whose polygon intersects the given viewport bbox. */
export async function findZonesInViewport(bbox: {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}): Promise<DangerZoneShape[]> {
  const rows = await db.execute<ZoneRow>(sql`
    select id, ST_AsGeoJSON(polygon) as polygon_geojson
    from ${dangerZones}
    where ST_Intersects(
      polygon,
      ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326)
    )
  `);
  return rows.map(rowToZoneShape);
}

/** Every zone's polygon, for routing's danger-avoidance check (see dangerProvider.ts). */
export async function findAllZonePolygons(): Promise<LatLng[][]> {
  const rows = await db.execute<ZoneRow>(sql`
    select id, ST_AsGeoJSON(polygon) as polygon_geojson from ${dangerZones}
  `);
  return rows.map(rowToZoneShape).map((zone) => zone.polygon);
}

/** A zone's persisted building list (resolved once at creation — see createDangerZone). */
export async function findZoneBuildings(zoneId: string): Promise<BuildingInZone[]> {
  const rows = await db
    .select({ outline: dangerZoneBuildings.outline, height: dangerZoneBuildings.height })
    .from(dangerZoneBuildings)
    .where(sql`${dangerZoneBuildings.zoneId} = ${zoneId}`);

  return rows.map((row) => ({
    outline: row.outline as LatLng[],
    height: row.height ?? undefined,
  }));
}
