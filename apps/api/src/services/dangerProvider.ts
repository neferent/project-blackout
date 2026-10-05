import { cellToBoundary, cellToLatLng, polygonToCells } from "h3-js";
import { sql } from "drizzle-orm";
import type { AreaCellDanger, DangerTier, LatLng } from "@blackout/shared";
import { AREA_H3_RESOLUTION, haversineKm } from "@blackout/shared";
import { db } from "../db/client.js";
import { areaDangerFetchedTiles, areaDangerTiers, buildingLookups, powerPlants, powerSubstations } from "../db/schema.js";
import { DANGER_FALLOFF_METERS, dangerTierFromDistanceMeters } from "./dangerMath.js";
import { TILE_DEGREES, tileKeysForBounds } from "./powerInfrastructureCache.js";

/**
 * Danger scored per AREA_H3_RESOLUTION cell (~0.015 km²), fed into routing as
 * avoid-zones and rendered client-side as tiered hex tinting (see
 * AreaDangerLayer.ts). Substations and plants are the actual danger sources
 * ("something lives in it" — see project_power_grid_danger_system design
 * notes); proximity to one scores a cell up to DANGER_MAX_METERS (off-limits)
 * falling off to DANGER_FALLOFF_METERS (safe). A disconnected building
 * (building_lookups.connected_to_grid = false, set by the `disconnect`
 * action) neutralizes danger in its immediate vicinity regardless of how
 * close a source is — that's the whole point of the disconnect mechanic.
 *
 * Results are cached in Postgres (areaDangerTiers/areaDangerFetchedTiles),
 * same coarse-tile coverage-tracking pattern as powerInfrastructureCache.ts:
 * once a tile's cells are scored, later requests covering it are served
 * straight from the cache instead of recomputing. See
 * invalidateAreaDangerCacheNear for the one thing that invalidates it.
 */
export interface DangerProvider {
  /** Every non-safe-tier AREA_H3_RESOLUTION cell intersecting the given bbox. */
  tiersInViewport(bbox: Bbox): Promise<AreaCellDanger[]>;
  /** Polygons (closed rings) routing should be able to route around, within the given bbox. */
  dangerZones(bbox: Bbox): Promise<LatLng[][]>;
}

export interface Bbox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** How far a disconnected building's safety extends around it — also the invalidation radius. */
export const DISCONNECTED_SAFE_RADIUS_METERS = 100;

/** Bounding box around a set of points, padded by `meters` — for scoping a route's danger check. */
export function bboxAroundPoints(points: LatLng[], meters: number): Bbox {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return expandBbox(
    { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) },
    meters,
  );
}

function expandBbox(bbox: Bbox, meters: number): Bbox {
  const latDegrees = meters / 111_320;
  const lngDegrees = meters / (111_320 * Math.cos((((bbox.minLat + bbox.maxLat) / 2) * Math.PI) / 180));
  return {
    minLat: bbox.minLat - latDegrees,
    maxLat: bbox.maxLat + latDegrees,
    minLng: bbox.minLng - lngDegrees,
    maxLng: bbox.maxLng + lngDegrees,
  };
}

function bboxEnvelopeWkt(bbox: Bbox): ReturnType<typeof sql> {
  return sql`ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326)`;
}

function bboxToH3Loop(bbox: Bbox): [number, number][] {
  return [
    [bbox.maxLat, bbox.minLng],
    [bbox.maxLat, bbox.maxLng],
    [bbox.minLat, bbox.maxLng],
    [bbox.minLat, bbox.minLng],
  ];
}

/**
 * Every power source position within `bbox` (already expanded by
 * DANGER_FALLOFF_METERS by the caller) — fetched once per tile so per-cell
 * scoring is plain in-process haversine math, not one DB round-trip per cell.
 */
async function powerSourcesIn(bbox: Bbox): Promise<LatLng[]> {
  const envelope = bboxEnvelopeWkt(bbox);
  const rows = await db.execute<{ lat: number; lng: number }>(sql`
    select ST_Y(p) as lat, ST_X(p) as lng from (
      select coalesce(position, ST_Centroid(footprint)) as p from ${powerSubstations}
      where ST_Intersects(coalesce(position, footprint), ${envelope})
      union all
      select coalesce(position, ST_Centroid(footprint)) as p from ${powerPlants}
      where ST_Intersects(coalesce(position, footprint), ${envelope})
    ) sources
  `);
  return rows.map((r) => ({ lat: r.lat, lng: r.lng }));
}

/** Every disconnected building's outline centroid within `bbox`. */
async function disconnectedBuildingCentroidsIn(bbox: Bbox): Promise<LatLng[]> {
  const envelope = bboxEnvelopeWkt(bbox);
  const rows = await db.execute<{ lat: number; lng: number }>(sql`
    select ST_Y(ST_Centroid(outline)) as lat, ST_X(ST_Centroid(outline)) as lng
    from ${buildingLookups}
    where connected_to_grid = false and ST_Intersects(outline, ${envelope})
  `);
  return rows.map((r) => ({ lat: r.lat, lng: r.lng }));
}

function nearestDistanceMeters(point: LatLng, sources: LatLng[]): number | null {
  if (sources.length === 0) return null;
  return Math.min(...sources.map((s) => haversineKm(point, s) * 1000));
}

async function findUnscoredTileKeys(tileKeys: string[]): Promise<string[]> {
  if (tileKeys.length === 0) return [];
  const rows = await db.execute<{ tile_key: string }>(sql`
    select tile_key from ${areaDangerFetchedTiles}
    where tile_key in (${sql.join(
      tileKeys.map((key) => sql`${key}`),
      sql`, `,
    )})
  `);
  const scored = new Set(rows.map((row) => row.tile_key));
  return tileKeys.filter((key) => !scored.has(key));
}

function tileKeyBounds(tileKey: string): Bbox {
  const [row, col] = tileKey.split(":").map(Number);
  return {
    minLat: row * TILE_DEGREES,
    maxLat: (row + 1) * TILE_DEGREES,
    minLng: col * TILE_DEGREES,
    maxLng: (col + 1) * TILE_DEGREES,
  };
}

/** Scores every AREA_H3_RESOLUTION cell within one coverage tile and persists the non-safe ones. */
async function scoreTile(tileKey: string): Promise<void> {
  const tileBounds = tileKeyBounds(tileKey);
  const scoringBbox = expandBbox(tileBounds, DANGER_FALLOFF_METERS);
  const [sources, disconnectedCentroids] = await Promise.all([
    powerSourcesIn(scoringBbox),
    disconnectedBuildingCentroidsIn(scoringBbox),
  ]);

  const cells = polygonToCells([bboxToH3Loop(tileBounds)], AREA_H3_RESOLUTION, false);

  const toInsert: { cell: string; tier: DangerTier; lat: number; lng: number }[] = [];
  for (const cell of cells) {
    const [lat, lng] = cellToLatLng(cell);
    const point: LatLng = { lat, lng };

    const disconnectedDistanceM = nearestDistanceMeters(point, disconnectedCentroids);
    if (disconnectedDistanceM !== null && disconnectedDistanceM <= DISCONNECTED_SAFE_RADIUS_METERS) continue;

    const distanceM = nearestDistanceMeters(point, sources);
    if (distanceM === null) continue;
    const tier = dangerTierFromDistanceMeters(distanceM);
    if (tier !== "safe") toInsert.push({ cell, tier, lat, lng });
  }

  if (toInsert.length > 0) {
    await db
      .insert(areaDangerTiers)
      .values(
        toInsert.map((r) => ({
          cell: r.cell,
          tier: r.tier,
          position: sql`ST_SetSRID(ST_MakePoint(${r.lng}, ${r.lat}), 4326)`,
        })),
      )
      .onConflictDoUpdate({ target: areaDangerTiers.cell, set: { tier: sql`excluded.tier`, computedAt: sql`now()` } });
  }

  await db.insert(areaDangerFetchedTiles).values({ tileKey }).onConflictDoNothing();
}

/** Ensures every tile covering `bbox` has been scored at least once. */
async function ensureAreaDangerScored(bbox: Bbox): Promise<void> {
  const tileKeys = tileKeysForBounds(bbox);
  const unscored = await findUnscoredTileKeys(tileKeys);
  for (const tileKey of unscored) {
    await scoreTile(tileKey);
  }
}

/**
 * Deletes cached tiers within `radiusMeters` of `point` — called by the
 * `disconnect` action (see actions.ts) since it can turn a cached
 * off-limits/very-dangerous/slightly-dangerous cell safe, which the cache
 * has no other way to learn about. An absent row already reads as "safe"
 * (see areaDangerTiers's schema comment), so a delete is all invalidation
 * needs — nothing has to be recomputed or re-marked unscored.
 */
export async function invalidateAreaDangerCacheNear(point: LatLng, radiusMeters: number): Promise<void> {
  await db.execute(sql`
    delete from ${areaDangerTiers}
    where ST_DWithin(
      position::geography,
      ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography,
      ${radiusMeters}
    )
  `);
}

export const dangerProvider: DangerProvider = {
  async tiersInViewport(bbox: Bbox): Promise<AreaCellDanger[]> {
    await ensureAreaDangerScored(bbox);

    const cells = polygonToCells([bboxToH3Loop(bbox)], AREA_H3_RESOLUTION, false);
    if (cells.length === 0) return [];

    const rows = await db.execute<{ cell: string; tier: DangerTier }>(sql`
      select cell, tier from ${areaDangerTiers}
      where cell in (${sql.join(
        cells.map((cell) => sql`${cell}`),
        sql`, `,
      )})
    `);
    return rows.map((r) => ({ cell: r.cell, tier: r.tier }));
  },

  async dangerZones(bbox: Bbox): Promise<LatLng[][]> {
    const tiers = await dangerProvider.tiersInViewport(bbox);
    return tiers
      .filter((c) => c.tier === "very-dangerous" || c.tier === "off-limits")
      .map((c) => cellToBoundary(c.cell, true).map(([lng, lat]) => ({ lat, lng })));
  },
};
