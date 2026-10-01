-- osm2pgsql flex-output style for the Phase 1 BC power-grid import (see
-- project_power_grid_danger_system memory / CLAUDE.md non-negotiables: OSM
-- never supplies primary keys, only coordinates).
--
-- Writes into a separate `osm_import` staging schema, deliberately NOT the
-- drizzle-owned tables (power_lines, power_towers, power_substations,
-- power_plants, roads) — apps/api/src/scripts/importPowerGridFromStaging.ts
-- does that upsert step afterwards, keyed by (osm_type, osm_id), the same
-- pattern already used by buildingLookups/powerInfrastructureCache. This
-- keeps drizzle migrations the single source of truth for final schema and
-- lets the staging tables be dropped/rebuilt freely between import runs.
--
-- power=substation/plant can be mapped as a node OR a way/relation footprint
-- (same ambiguity as buildings — see buildingLookups). Point and area
-- variants are staged in separate tables and reconciled by osm_type+osm_id
-- in the upsert step, since a bare integer osm_id can collide across node/
-- way/relation namespaces.

-- The `osm_import` schema itself is created by entrypoint.sh (via psql)
-- before osm2pgsql runs, since flex output expects it to already exist.

-- Geometry columns default to 3857 (web mercator) in osm2pgsql flex output;
-- `projection = 4326` on the column itself (not a table-level option) is
-- what actually controls this — verified against osm2pgsql 1.8's behavior,
-- since our drizzle-owned tables are all SRID 4326 (WGS84, see schema.ts).

local function area_table(name)
  return osm2pgsql.define_area_table('osm_import_' .. name, {
    { column = 'osm_type', type = 'text', not_null = true },
    { column = 'osm_id', type = 'text', not_null = true },
    { column = 'name', type = 'text' },
    { column = 'geom', type = 'geometry', projection = 4326, not_null = true },
  }, { schema = 'osm_import' })
end

local function point_table(name)
  return osm2pgsql.define_node_table('osm_import_' .. name, {
    { column = 'osm_id', type = 'text', not_null = true },
    { column = 'name', type = 'text' },
    { column = 'geom', type = 'point', projection = 4326, not_null = true },
  }, { schema = 'osm_import' })
end

local power_lines = osm2pgsql.define_way_table('osm_import_power_lines', {
  { column = 'osm_id', type = 'text', not_null = true },
  { column = 'geom', type = 'linestring', projection = 4326, not_null = true },
}, { schema = 'osm_import' })

local power_towers = point_table('power_towers')
local power_substations_points = point_table('power_substations_points')
local power_substations_areas = area_table('power_substations_areas')
local power_plants_points = point_table('power_plants_points')
local power_plants_areas = area_table('power_plants_areas')

local roads = osm2pgsql.define_way_table('osm_import_roads', {
  { column = 'osm_id', type = 'text', not_null = true },
  { column = 'highway', type = 'text', not_null = true },
  { column = 'name', type = 'text' },
  { column = 'geom', type = 'linestring', projection = 4326, not_null = true },
}, { schema = 'osm_import' })

function osm2pgsql.process_node(object)
  local power = object.tags.power
  if power == 'tower' then
    power_towers:insert({ osm_id = tostring(object.id), name = object.tags.name, geom = object:as_point() })
  elseif power == 'substation' then
    power_substations_points:insert({ osm_id = tostring(object.id), name = object.tags.name, geom = object:as_point() })
  elseif power == 'plant' then
    power_plants_points:insert({ osm_id = tostring(object.id), name = object.tags.name, geom = object:as_point() })
  end
end

function osm2pgsql.process_way(object)
  local power = object.tags.power
  if power == 'line' then
    power_lines:insert({ osm_id = tostring(object.id), geom = object:as_linestring() })
  elseif power == 'substation' and object.is_closed then
    power_substations_areas:insert({
      osm_type = 'way',
      osm_id = tostring(object.id),
      name = object.tags.name,
      geom = object:as_polygon(),
    })
  elseif power == 'plant' and object.is_closed then
    power_plants_areas:insert({
      osm_type = 'way',
      osm_id = tostring(object.id),
      name = object.tags.name,
      geom = object:as_polygon(),
    })
  end

  if object.tags.highway then
    roads:insert({
      osm_id = tostring(object.id),
      highway = object.tags.highway,
      name = object.tags.name,
      geom = object:as_linestring(),
    })
  end
end

function osm2pgsql.process_relation(object)
  if object.tags.type ~= 'multipolygon' then
    return
  end

  local power = object.tags.power
  if power == 'substation' then
    power_substations_areas:insert({
      osm_type = 'relation',
      osm_id = tostring(object.id),
      name = object.tags.name,
      geom = object:as_multipolygon(),
    })
  elseif power == 'plant' then
    power_plants_areas:insert({
      osm_type = 'relation',
      osm_id = tostring(object.id),
      name = object.tags.name,
      geom = object:as_multipolygon(),
    })
  end
end

function osm2pgsql.select_relation_members(relation)
  if relation.tags.type == 'multipolygon' and (relation.tags.power == 'substation' or relation.tags.power == 'plant') then
    return { ways = osm2pgsql.way_member_ids(relation) }
  end
end
