import { sql } from "drizzle-orm";
import type { LatLng } from "@blackout/shared";
import { db } from "../db/client.js";
import { powerInfrastructureFetchedTiles, powerLines, powerTowers } from "../db/schema.js";
import { queryOverpassPowerInfrastructure } from "./overpass.js";

export interface Bounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/**
 * Coverage-tracking tile size (degrees), independent of H3_RESOLUTION (that
 * tracks player position at a much finer grain — see schema.ts). Coarse
 * enough that a typical city-scale viewport (MapView.vue's default zoom 14)
 * needs only a handful of tiles marked fetched, ever; fine enough that
 * filling a gap — one Overpass call for the whole requested viewport, not
 * per-tile, see ensurePowerInfrastructureFetched below — stays a reasonable
 * query size even when several tiles are cold at once.
 *
 * Exported so the Phase 1 bulk-import script (importPowerGridFromStaging.ts)
 * can mark every tile a province extract covers as fetched — without that,
 * this cache has no way to know a region is already fully covered by the
 * bulk import and keeps gating it behind a live (redundant, sometimes
 * failing) Overpass call. See that script for the actual backfill.
 */
export const TILE_DEGREES = 0.1;

export function tileKeysForBounds(bounds: Bounds): string[] {
  const minRow = Math.floor(bounds.minLat / TILE_DEGREES);
  const maxRow = Math.floor(bounds.maxLat / TILE_DEGREES);
  const minCol = Math.floor(bounds.minLng / TILE_DEGREES);
  const maxCol = Math.floor(bounds.maxLng / TILE_DEGREES);

  const keys: string[] = [];
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      keys.push(`${row}:${col}`);
    }
  }
  return keys;
}

async function findUnfetchedTileKeys(tileKeys: string[]): Promise<string[]> {
  if (tileKeys.length === 0) return [];
  const rows = await db.execute<{ tile_key: string }>(sql`
    select tile_key from ${powerInfrastructureFetchedTiles}
    where tile_key in (${sql.join(
      tileKeys.map((key) => sql`${key}`),
      sql`, `,
    )})
  `);
  const fetched = new Set(rows.map((row) => row.tile_key));
  return tileKeys.filter((key) => !fetched.has(key));
}

function lineToWkt(points: LatLng[]): string {
  return `LINESTRING(${points.map((p) => `${p.lng} ${p.lat}`).join(", ")})`;
}

/**
 * Ensures every tile covering `bounds` has been fetched from Overpass at
 * least once, persisting whatever it finds so later requests for the same
 * area are served from Postgres instead. Returns false (leaving any
 * existing cache untouched) if the Overpass call needed to fill a gap
 * failed or timed out — callers should treat that as "couldn't refresh",
 * not "confirmed empty", the same distinction queryOverpassPowerInfrastructure
 * already draws.
 */
export async function ensurePowerInfrastructureFetched(bounds: Bounds): Promise<boolean> {
  const tileKeys = tileKeysForBounds(bounds);
  const unfetchedKeys = await findUnfetchedTileKeys(tileKeys);
  if (unfetchedKeys.length === 0) return true;

  // One Overpass call for the whole requested viewport, not one per missing tile — upserts
  // below are idempotent even where this overlaps already-fetched tiles, and this avoids an
  // N-tile storm of sequential throttled Overpass calls on a big or cold pan.
  const found = await queryOverpassPowerInfrastructure(bounds);
  if (found === null) return false;

  if (found.lines.length > 0) {
    await db
      .insert(powerLines)
      .values(
        found.lines.map((line) => ({
          osmId: line.osmId,
          line: sql`ST_SetSRID(ST_GeomFromText(${lineToWkt(line.points)}), 4326)`,
        })),
      )
      .onConflictDoUpdate({ target: powerLines.osmId, set: { line: sql`excluded.line` } });
  }

  if (found.towers.length > 0) {
    await db
      .insert(powerTowers)
      .values(
        found.towers.map((tower) => ({
          osmId: tower.osmId,
          position: sql`ST_SetSRID(ST_MakePoint(${tower.point.lng}, ${tower.point.lat}), 4326)`,
        })),
      )
      .onConflictDoUpdate({ target: powerTowers.osmId, set: { position: sql`excluded.position` } });
  }

  await db
    .insert(powerInfrastructureFetchedTiles)
    .values(unfetchedKeys.map((tileKey) => ({ tileKey })))
    .onConflictDoNothing();

  return true;
}

interface LineRow extends Record<string, unknown> {
  geojson: string;
}
interface TowerRow extends Record<string, unknown> {
  geojson: string;
}

/** Everything cached that intersects `bounds` — call only after ensurePowerInfrastructureFetched. */
export async function findPowerInfrastructureInViewport(
  bounds: Bounds,
): Promise<{ lines: LatLng[][]; towers: LatLng[] }> {
  const envelope = sql`ST_MakeEnvelope(${bounds.minLng}, ${bounds.minLat}, ${bounds.maxLng}, ${bounds.maxLat}, 4326)`;

  const lineRows = await db.execute<LineRow>(sql`
    select ST_AsGeoJSON(line) as geojson from ${powerLines} where ST_Intersects(line, ${envelope})
  `);
  const towerRows = await db.execute<TowerRow>(sql`
    select ST_AsGeoJSON(position) as geojson from ${powerTowers} where ST_Intersects(position, ${envelope})
  `);

  const lines = lineRows.map((row) => {
    const geojson = JSON.parse(row.geojson) as { coordinates: [number, number][] };
    return geojson.coordinates.map(([lng, lat]) => ({ lat, lng }));
  });
  const towers = towerRows.map((row) => {
    const geojson = JSON.parse(row.geojson) as { coordinates: [number, number] };
    const [lng, lat] = geojson.coordinates;
    return { lat, lng };
  });

  return { lines, towers };
}
