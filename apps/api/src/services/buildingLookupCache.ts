import { sql } from "drizzle-orm";
import type { BuildingLookup, LatLng } from "@blackout/shared";
import { db } from "../db/client.js";
import { buildingLookups } from "../db/schema.js";

/** MULTIPOLYGON WKT: each outer ring becomes its own polygon (no holes — see overpass.ts). */
function outlineToWkt(outline: LatLng[][]): string {
  const polygons = outline.map((ring) => `((${ring.map((p) => `${p.lng} ${p.lat}`).join(", ")}))`);
  return `MULTIPOLYGON(${polygons.join(", ")})`;
}

interface CachedRow extends Record<string, unknown> {
  osm_type: string;
  osm_id: string;
  name: string | null;
  shop: string | null;
  amenity: string | null;
  building: string | null;
  contains: unknown;
  connected_to_grid: boolean;
  outline_geojson: string;
}

function rowToBuildingLookup(row: CachedRow): BuildingLookup {
  const geojson = JSON.parse(row.outline_geojson) as { coordinates: [number, number][][][] };
  const outline = geojson.coordinates.map((polygon) => polygon[0].map(([lng, lat]) => ({ lat, lng })));
  return {
    osmType: row.osm_type as "way" | "relation",
    osmId: row.osm_id,
    name: row.name ?? undefined,
    shop: row.shop ?? undefined,
    amenity: row.amenity ?? undefined,
    building: row.building ?? undefined,
    outline,
    contains: row.contains as BuildingLookup["contains"],
    connectedToGrid: row.connected_to_grid,
  };
}

const SELECT_COLUMNS = sql`osm_type, osm_id, name, shop, amenity, building, contains, connected_to_grid,
           ST_AsGeoJSON(outline) as outline_geojson`;

/** Point-in-polygon lookup against cached building footprints, via PostGIS' GIST index. */
export async function findCachedBuilding(position: LatLng): Promise<BuildingLookup | null> {
  const [row] = await db.execute<CachedRow>(sql`
    select ${SELECT_COLUMNS}
    from ${buildingLookups}
    where ST_Contains(outline, ST_SetSRID(ST_MakePoint(${position.lng}, ${position.lat}), 4326))
    limit 1
  `);
  return row ? rowToBuildingLookup(row) : null;
}

/** Looked up by the same OSM identity the client got from a prior /buildings/lookup call. */
export async function findBuildingByOsmId(osmType: "way" | "relation", osmId: string): Promise<BuildingLookup | null> {
  const [row] = await db.execute<CachedRow>(sql`
    select ${SELECT_COLUMNS}
    from ${buildingLookups}
    where osm_type = ${osmType} and osm_id = ${osmId}
    limit 1
  `);
  return row ? rowToBuildingLookup(row) : null;
}

/** Flips a cached building's grid connection — the `disconnect` action's only effect. */
export async function setBuildingConnectedToGrid(
  osmType: "way" | "relation",
  osmId: string,
  connectedToGrid: boolean,
): Promise<void> {
  await db.execute(sql`
    update ${buildingLookups}
    set connected_to_grid = ${connectedToGrid}
    where osm_type = ${osmType} and osm_id = ${osmId}
  `);
}

/** Flattened average of every ring's points — good enough for "roughly where this building is". */
export function centroidOfOutline(outline: LatLng[][]): LatLng {
  const points = outline.flat();
  return {
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
    lng: points.reduce((sum, p) => sum + p.lng, 0) / points.length,
  };
}

/** Upserts by (osm_type, osm_id) so re-fetching the same OSM feature refreshes it in place. */
export async function cacheBuilding(building: BuildingLookup): Promise<void> {
  const outlineWkt = outlineToWkt(building.outline);
  await db.execute(sql`
    insert into ${buildingLookups} (osm_type, osm_id, name, shop, amenity, building, outline, contains)
    values (
      ${building.osmType}, ${building.osmId}, ${building.name ?? null}, ${building.shop ?? null},
      ${building.amenity ?? null}, ${building.building ?? null},
      ST_SetSRID(ST_GeomFromText(${outlineWkt}), 4326),
      ${JSON.stringify(building.contains)}::jsonb
    )
    on conflict (osm_type, osm_id) do update set
      name = excluded.name,
      shop = excluded.shop,
      amenity = excluded.amenity,
      building = excluded.building,
      outline = excluded.outline,
      contains = excluded.contains
  `);
}
