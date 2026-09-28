import { sql } from "drizzle-orm";
import { customType, doublePrecision, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
  // The player's chosen start point: their base/shelter. Fixed at creation for
  // the POC (no relocating a base yet) — distinct from `position`, which moves
  // as they travel. Plain lat/lng columns since it's display-only for now.
  baseLat: doublePrecision("base_lat").notNull(),
  baseLng: doublePrecision("base_lng").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
