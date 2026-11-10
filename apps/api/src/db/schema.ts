import { sql } from "drizzle-orm";
import { boolean, customType, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** PostGIS geometry column, SRID 4326 (WGS84 lat/lng). */
const geometryPoint = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geometry(Point, 4326)";
  },
});

const geometryLineString = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geometry(LineString, 4326)";
  },
});

/** Rendered as one polygon per outer ring (way buildings have one, multipolygon relations may have several). */
const geometryMultiPolygon = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geometry(MultiPolygon, 4326)";
  },
});

/**
 * H3 cell index, resolution fixed by H3_RESOLUTION in shared constants.
 * Computed in application code (h3-js); stored as text since the h3-pg
 * extension isn't bundled in the postgis/postgis image and nothing here
 * needs H3 SQL functions.
 */
const h3Index = customType<{ data: string; driverData: string }>({
  dataType() {
    return "text";
  },
});

export const players = pgTable("players", {
  id: uuid("id").primaryKey().defaultRandom(),
  anonKey: text("anon_key").notNull().unique(),
  position: geometryPoint("position").notNull(),
  currentH3Cell: h3Index("current_h3_cell").notNull(),
  // The player's base/shelter: the whole INTERACTION_H3_RESOLUTION hex the
  // chosen start point falls in, not an exact point — basePosition is always
  // this cell's center. Fixed at creation for the POC (no relocating a base
  // yet) — distinct from `position`, which moves as they travel.
  baseH3Cell: h3Index("base_h3_cell").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A player's base: the hex-of-hexes board previewed in StartPicker, persisted at
 * creation time (see ARCHITECTURE.md "Base hex grid"). Phase 2 as currently scoped
 * trusts the client's classification wholesale (`gridData`) rather than re-deriving
 * it from OSM server-side — the grid is cosmetic/preview-grade by design even in the
 * client (zoom-simplified vector tiles, stretched to a fixed board shape), so there's
 * no authoritative ground truth to re-derive it from yet. One base per player for the
 * POC; multi-base is out of scope (see CLAUDE.md).
 */
export const bases = pgTable("bases", {
  id: uuid("id").primaryKey().defaultRandom(),
  playerId: uuid("player_id")
    .notNull()
    .unique()
    .references(() => players.id, { onDelete: "cascade" }),
  hexCell: h3Index("hex_cell").notNull(),
  radius: integer("radius").notNull(),
  gridData: jsonb("grid_data").notNull(),
  // Bumped each time a layout commit finalizes; `layoutEfficiency` is the cached
  // evaluateLayout() result for the current layout (null = recompute on next read).
  layoutVersion: integer("layout_version").notNull().default(0),
  layoutEfficiency: jsonb("layout_efficiency"),
  starterKitGranted: boolean("starter_kit_granted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per board cell with its typed tile (indoor/yard/garden/paved/water/road),
 * derived from `bases.gridData` at creation. This — not grid_data — is authoritative
 * for layout rules, since tile conversion will mutate it (`convertedFrom`).
 */
export const baseTiles = pgTable(
  "base_tiles",
  {
    baseId: uuid("base_id")
      .notNull()
      .references(() => bases.id, { onDelete: "cascade" }),
    q: integer("q").notNull(),
    r: integer("r").notNull(),
    tileType: text("tile_type").notNull(),
    convertedFrom: text("converted_from"),
    /** Player-set designation ("walkway" | "clear"); null = plain tile. Rules: baseLayout config. */
    designation: text("designation"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.baseId, table.q, table.r] }),
  }),
);

/**
 * Item instances: each has its own quality and owner (tradable later — transfer is an
 * UPDATE of owner_player_id). `definitionId` is a key into the base-layout config, never
 * a foreign key (rules live in config, not the DB).
 */
export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerPlayerId: uuid("owner_player_id")
    .notNull()
    .references(() => players.id, { onDelete: "cascade" }),
  definitionId: text("definition_id").notNull(),
  quality: numeric("quality", { precision: 5, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Where an item instance currently sits in a base. An item is placed at most once. */
export const placements = pgTable(
  "placements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    baseId: uuid("base_id")
      .notNull()
      .references(() => bases.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .unique()
      .references(() => items.id, { onDelete: "cascade" }),
    q: integer("q").notNull(),
    r: integer("r").notNull(),
    facing: integer("facing").notNull(),
    kind: text("kind").notNull(),
  },
  (table) => ({
    tileUnique: uniqueIndex("placements_base_tile_unique").on(table.baseId, table.q, table.r),
  }),
);

/**
 * Generic action log: travel today, scavenge/craft/rest later. Server never
 * trusts client time — state is always derived from starts_at/ends_at on read.
 */
export const actions = pgTable("actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  playerId: uuid("player_id")
    .notNull()
    .references(() => players.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  route: geometryLineString("route"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Cache of Overpass building lookups, keyed by geometry rather than a
 * client-supplied cell: a click is resolved to a cached row by point-in-
 * polygon (`ST_Contains`) against `outline`, so any point still inside a
 * previously-looked-up building's footprint is served from the DB instead of
 * re-querying Overpass. `osmType`/`osmId` identify the source OSM feature for
 * de-duplication only — never used as a key elsewhere per project convention.
 */
export const buildingLookups = pgTable(
  "building_lookups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    osmType: text("osm_type").notNull(),
    osmId: text("osm_id").notNull(),
    name: text("name"),
    shop: text("shop"),
    amenity: text("amenity"),
    building: text("building"),
    outline: geometryMultiPolygon("outline").notNull(),
    contains: jsonb("contains").notNull().default(sql`'[]'::jsonb`),
    // The power-grid danger mechanic's core per-building state (see CLAUDE.md).
    // Starts true; the `disconnect` ActionKind (apps/api/src/actions/disconnect.ts)
    // flips it false and nothing currently flips it back.
    connectedToGrid: boolean("connected_to_grid").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    osmUnique: uniqueIndex("building_lookups_osm_unique").on(table.osmType, table.osmId),
    outlineIdx: index("building_lookups_outline_idx").using("gist", table.outline),
  }),
);

/** Cache of Overpass `power=line` ways — see powerInfrastructureCache.ts. */
export const powerLines = pgTable(
  "power_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    osmId: text("osm_id").notNull().unique(),
    line: geometryLineString("line").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    lineIdx: index("power_lines_line_idx").using("gist", table.line),
  }),
);

/** Cache of Overpass `power=tower` nodes — see powerInfrastructureCache.ts. */
export const powerTowers = pgTable(
  "power_towers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    osmId: text("osm_id").notNull().unique(),
    position: geometryPoint("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    positionIdx: index("power_towers_position_idx").using("gist", table.position),
  }),
);

/**
 * Coarse-grid coverage tracker for the power-infrastructure cache: once
 * every tile covering a queried viewport is marked fetched, later requests
 * for the same area are served straight from power_lines/power_towers
 * without re-hitting Overpass (see powerInfrastructureCache.ts). Tile size
 * is independent of H3_RESOLUTION — this tracks coarse "have we ever
 * queried this area" coverage, not player position, so it doesn't belong
 * on the h3Index convention used for that.
 */
export const powerInfrastructureFetchedTiles = pgTable("power_infrastructure_fetched_tiles", {
  tileKey: text("tile_key").primaryKey(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Cache of AREA_H3_RESOLUTION cells' danger tiers (see dangerProvider.ts),
 * keyed by H3 cell string. Only non-"safe" cells are ever inserted — the API
 * always omits safe cells from responses, so an absent cell reads as safe.
 * `position` (the cell's center, cellToLatLng) exists only so a `disconnect`
 * action can invalidate/delete the cells it affects (see
 * dangerProvider.ts's invalidateAreaDangerCacheNear) — nothing queries it by
 * viewport; that's done by re-deriving the cell id list in app code
 * (polygonToCells) and looking them up by primary key instead.
 */
export const areaDangerTiers = pgTable(
  "area_danger_tiers",
  {
    cell: text("cell").primaryKey(),
    tier: text("tier").notNull(),
    position: geometryPoint("position").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    positionIdx: index("area_danger_tiers_position_idx").using("gist", table.position),
  }),
);

/**
 * Coarse-grid coverage tracker for areaDangerTiers, same pattern/tile size as
 * powerInfrastructureFetchedTiles — once a tile is marked scored, later
 * viewport requests covering it are served from areaDangerTiers without
 * recomputing (see dangerProvider.ts).
 */
export const areaDangerFetchedTiles = pgTable("area_danger_fetched_tiles", {
  tileKey: text("tile_key").primaryKey(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Buildings resolved from Overpass for one AREA_H3_RESOLUTION cell, cached
 * once and served from here forever after — a row existing (even with an
 * empty `buildings` array) means "already resolved", distinguishing a
 * not-yet-queried cell from one queried and found to have no buildings. Only
 * written for cells the client actually asked about (today: off-limits tier
 * only — see zones.ts), not eagerly for every scored cell.
 */
export const areaDangerCellBuildings = pgTable("area_danger_cell_buildings", {
  cell: text("cell").primaryKey(),
  buildings: jsonb("buildings").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `power=substation` — the actual danger sources, not the lines/towers that
 * merely carry current. Frequently mapped as either a node or a way/relation
 * footprint (same situation as buildings, see buildingLookups), so both
 * `position` and `footprint` are nullable and exactly one is populated
 * depending on how OSM mapped the source feature. Populated by the BC bulk
 * import pipeline (osm2pgsql, see docker/osm2pgsql/) for in-scope provinces;
 * out-of-scope areas simply have no rows here yet — no Overpass fallback for
 * this tier, unlike power_lines/power_towers.
 */
export const powerSubstations = pgTable(
  "power_substations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    osmType: text("osm_type").notNull(),
    osmId: text("osm_id").notNull(),
    name: text("name"),
    position: geometryPoint("position"),
    footprint: geometryMultiPolygon("footprint"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    osmUnique: uniqueIndex("power_substations_osm_unique").on(table.osmType, table.osmId),
    positionIdx: index("power_substations_position_idx").using("gist", table.position),
    footprintIdx: index("power_substations_footprint_idx").using("gist", table.footprint),
  }),
);

/** `power=plant` — same point-or-polygon shape as power_substations, see above. */
export const powerPlants = pgTable(
  "power_plants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    osmType: text("osm_type").notNull(),
    osmId: text("osm_id").notNull(),
    name: text("name"),
    position: geometryPoint("position"),
    footprint: geometryMultiPolygon("footprint"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    osmUnique: uniqueIndex("power_plants_osm_unique").on(table.osmType, table.osmId),
    positionIdx: index("power_plants_position_idx").using("gist", table.position),
    footprintIdx: index("power_plants_footprint_idx").using("gist", table.footprint),
  }),
);

/**
 * Full road hierarchy (`highway=*`, motorways included) from the BC bulk
 * import. `highway` is kept so building-connection resolution (Phase 2) can
 * restrict its "nearest local road" match to residential/unclassified/
 * tertiary/service/living_street and exclude motorways/trunk roads — see
 * the "Building connection resolution" reasoning this table exists for.
 */
export const roads = pgTable(
  "roads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    osmId: text("osm_id").notNull().unique(),
    highway: text("highway").notNull(),
    name: text("name"),
    line: geometryLineString("line").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    lineIdx: index("roads_line_idx").using("gist", table.line),
    highwayIdx: index("roads_highway_idx").on(table.highway),
  }),
);
