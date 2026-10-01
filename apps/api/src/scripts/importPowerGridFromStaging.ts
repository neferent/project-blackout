/**
 * Phase 1 BC import, step 2: upserts the `osm_import.*` staging tables
 * (populated by docker/osm2pgsql/style.lua via `docker compose --profile
 * import run --rm power-grid-import`) into the drizzle-owned power_lines/
 * power_towers/power_substations/power_plants/roads tables.
 *
 * Kept as a separate step (rather than having osm2pgsql write the final
 * tables directly) so drizzle migrations stay the single source of truth
 * for schema, and so re-running the import never requires osm2pgsql itself
 * to know about our upsert/dedup rules — see docker/osm2pgsql/style.lua's
 * header comment.
 *
 * Run via: pnpm --filter api import:power-grid
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { TILE_DEGREES } from "../services/powerInfrastructureCache.js";

async function main() {
  console.log("Upserting power_lines...");
  await db.execute(sql`
    insert into power_lines (osm_id, line)
    select osm_id, geom from osm_import.osm_import_power_lines
    on conflict (osm_id) do update set line = excluded.line
  `);

  console.log("Upserting power_towers...");
  await db.execute(sql`
    insert into power_towers (osm_id, position)
    select osm_id, geom from osm_import.osm_import_power_towers
    on conflict (osm_id) do update set position = excluded.position
  `);

  console.log("Upserting roads...");
  await db.execute(sql`
    insert into roads (osm_id, highway, name, line)
    select osm_id, highway, name, geom from osm_import.osm_import_roads
    on conflict (osm_id) do update set highway = excluded.highway, name = excluded.name, line = excluded.line
  `);

  console.log("Upserting power_substations (point-mapped)...");
  await db.execute(sql`
    insert into power_substations (osm_type, osm_id, name, position)
    select 'node', osm_id, name, geom from osm_import.osm_import_power_substations_points
    on conflict (osm_type, osm_id) do update set name = excluded.name, position = excluded.position
  `);

  console.log("Upserting power_substations (area-mapped)...");
  await db.execute(sql`
    insert into power_substations (osm_type, osm_id, name, footprint)
    select osm_type, osm_id, name, ST_Multi(geom) from osm_import.osm_import_power_substations_areas
    on conflict (osm_type, osm_id) do update set name = excluded.name, footprint = excluded.footprint
  `);

  console.log("Upserting power_plants (point-mapped)...");
  await db.execute(sql`
    insert into power_plants (osm_type, osm_id, name, position)
    select 'node', osm_id, name, geom from osm_import.osm_import_power_plants_points
    on conflict (osm_type, osm_id) do update set name = excluded.name, position = excluded.position
  `);

  console.log("Upserting power_plants (area-mapped)...");
  await db.execute(sql`
    insert into power_plants (osm_type, osm_id, name, footprint)
    select osm_type, osm_id, name, ST_Multi(geom) from osm_import.osm_import_power_plants_areas
    on conflict (osm_type, osm_id) do update set name = excluded.name, footprint = excluded.footprint
  `);

  // Without this, powerInfrastructureCache.ts has no way to know this province is
  // already fully covered by the bulk import above — it would keep gating every
  // viewport in BC behind a live (redundant, sometimes-failing) Overpass call
  // until that exact tile happened to get touched by one. Backfilling coverage
  // from the roads we just imported (near-ubiquitous across the whole extract,
  // denser than power infra itself) makes the viewport endpoint serve straight
  // from Postgres for all of BC, as Phase 1 was designed to.
  //
  // Deliberately per-segment tile coverage (each road's own bbox, expanded to
  // every tile it spans), not one bbox over the whole province: BC's shape is
  // irregular, so a single bounding rectangle would falsely mark ocean/other-
  // province corners inside that rectangle as "already fetched" too, silently
  // suppressing legitimate live-Overpass fallback queries there later.
  console.log("Backfilling fetched-tile coverage for the imported extract...");
  const { count } = (
    await db.execute<{ count: number }>(sql`
    with inserted as (
      insert into power_infrastructure_fetched_tiles (tile_key)
      select distinct row || ':' || col
      from roads,
        lateral generate_series(floor(ST_YMin(line) / ${TILE_DEGREES})::int, floor(ST_YMax(line) / ${TILE_DEGREES})::int) as row,
        lateral generate_series(floor(ST_XMin(line) / ${TILE_DEGREES})::int, floor(ST_XMax(line) / ${TILE_DEGREES})::int) as col
      on conflict (tile_key) do nothing
      returning 1
    )
    select count(*)::int as count from inserted
  `)
  )[0];
  console.log(`Marked ${count} new tiles as fetched (${TILE_DEGREES}° grid).`);

  console.log("Dropping osm_import staging schema...");
  await db.execute(sql`drop schema if exists osm_import cascade`);

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
