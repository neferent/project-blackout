import { z } from "zod";

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof latLngSchema>;

/** GeoJSON LineString geometry, as returned by Valhalla (decoded) and stored in PostGIS. */
export const lineStringSchema = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(z.tuple([z.number(), z.number()])),
});
export type LineStringGeometry = z.infer<typeof lineStringSchema>;

export const playerSchema = z.object({
  id: z.string().uuid(),
  anonKey: z.string(),
  createdAt: z.coerce.date(),
});
export type Player = z.infer<typeof playerSchema>;

/** Mirrors HexCellClassification in apps/web/src/features/placement/hexGrid.ts. */
export const hexCellClassificationSchema = z.enum(["building", "water", "road", "landcover", "empty"]);
export type HexCellClassification = z.infer<typeof hexCellClassificationSchema>;

export const hexCellDataSchema = z.object({
  q: z.number(),
  r: z.number(),
  classification: hexCellClassificationSchema,
});
export type HexCellData = z.infer<typeof hexCellDataSchema>;

/**
 * The client-computed base board (see hexGrid.ts's classifyHexGrid) sent on create-player
 * and persisted as-is (`bases.gridData`) — cosmetic/preview-grade even on the client
 * (zoom-simplified vector tiles stretched onto a fixed board), so the server trusts it
 * rather than re-deriving it from OSM. The server does re-check the building-count
 * minimum before persisting, same rule as the client's hexGridWarning.
 */
export const hexGridResultSchema = z.object({
  radius: z.number(),
  cells: z.array(hexCellDataSchema),
  coverage: z.record(hexCellClassificationSchema, z.number()),
});
export type HexGridResult = z.infer<typeof hexGridResultSchema>;

export const createPlayerRequestSchema = z.object({
  position: latLngSchema,
  grid: hexGridResultSchema,
});
export type CreatePlayerRequest = z.infer<typeof createPlayerRequestSchema>;

export const baseSchema = z.object({
  id: z.string().uuid(),
  hexCell: z.string(),
  grid: hexGridResultSchema,
});
export type Base = z.infer<typeof baseSchema>;

/**
 * Action kinds. The registry is built to accept more (scavenge, craft, rest, ...)
 * without changing this list's consumers.
 */
export const actionKindSchema = z.enum(["travel", "disconnect", "layout"]);
export type ActionKind = z.infer<typeof actionKindSchema>;

export const travelActionDataSchema = z.object({
  origin: latLngSchema,
  destination: latLngSchema,
  route: lineStringSchema,
  distanceKm: z.number().positive(),
});
export type TravelActionData = z.infer<typeof travelActionDataSchema>;

/** Disconnecting a specific building from the power grid — see CLAUDE.md's core mechanic. */
export const disconnectActionDataSchema = z.object({
  buildingOsmType: z.enum(["way", "relation"]),
  buildingOsmId: z.string(),
  position: latLngSchema,
});
export type DisconnectActionData = z.infer<typeof disconnectActionDataSchema>;

export const startDisconnectRequestSchema = z.object({
  osmType: z.enum(["way", "relation"]),
  osmId: z.string(),
});
export type StartDisconnectRequest = z.infer<typeof startDisconnectRequestSchema>;

export const actionSchema = z.object({
  id: z.string().uuid(),
  playerId: z.string().uuid(),
  kind: actionKindSchema,
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  data: z.unknown(),
});
export type Action = z.infer<typeof actionSchema>;

/** A past trip's route, for drawing faded breadcrumbs of recently-traveled paths. */
export const travelHistoryItemSchema = z.object({
  id: z.string().uuid(),
  route: lineStringSchema,
  endsAt: z.coerce.date(),
});
export type TravelHistoryItem = z.infer<typeof travelHistoryItemSchema>;

export const travelHistoryResponseSchema = z.array(travelHistoryItemSchema);
export type TravelHistoryResponse = z.infer<typeof travelHistoryResponseSchema>;

export const routePreviewRequestSchema = z.object({
  origin: latLngSchema,
  destination: latLngSchema,
});
export type RoutePreviewRequest = z.infer<typeof routePreviewRequestSchema>;

export const routeAlternativeSchema = z.object({
  route: lineStringSchema,
  distanceKm: z.number().positive(),
  gameSeconds: z.number().positive(),
  realSeconds: z.number().positive(),
});
export type RouteAlternative = z.infer<typeof routeAlternativeSchema>;

export const routePreviewResponseSchema = z.object({
  route: lineStringSchema,
  distanceKm: z.number().positive(),
  gameSeconds: z.number().positive(),
  realSeconds: z.number().positive(),
  // Present only when `route` passes through a known danger zone — a second
  // route computed with that zone excluded from the pedestrian graph.
  avoidingDanger: routeAlternativeSchema.nullable(),
});
export type RoutePreviewResponse = z.infer<typeof routePreviewResponseSchema>;

export const startTravelRequestSchema = z.object({
  destination: latLngSchema,
  // Which route to take when the direct path crosses a danger zone (from the
  // preview's avoidingDanger alternative). Ignored when the direct path
  // doesn't cross one. Defaults to "avoiding" — the safer choice.
  routeChoice: z.enum(["direct", "avoiding"]).default("avoiding"),
});
export type StartTravelRequest = z.infer<typeof startTravelRequestSchema>;

export const buildingLookupRequestSchema = z.object({
  position: latLngSchema,
});
export type BuildingLookupRequest = z.infer<typeof buildingLookupRequestSchema>;

const buildingContainedFeatureSchema = z.object({
  name: z.string(),
  kind: z.string(),
});

/**
 * What's at a clicked point: the containing building (if any), its outline
 * (one ring per way, multiple outer rings for a multipolygon relation), and
 * other shop/amenity features enclosed by it (a store's sub-departments).
 */
export const buildingLookupSchema = z.object({
  osmType: z.enum(["way", "relation"]),
  osmId: z.string(),
  name: z.string().optional(),
  shop: z.string().optional(),
  amenity: z.string().optional(),
  building: z.string().optional(),
  outline: z.array(z.array(latLngSchema)),
  contains: z.array(buildingContainedFeatureSchema),
  // Whether the building is still wired into the grid — the mechanic's core
  // per-building state. Starts true; the `disconnect` action flips it false.
  connectedToGrid: z.boolean(),
});
export type BuildingLookup = z.infer<typeof buildingLookupSchema>;

export const buildingLookupResponseSchema = buildingLookupSchema.nullable();
export type BuildingLookupResponse = z.infer<typeof buildingLookupResponseSchema>;

const buildingInZoneSchema = z.object({
  outline: z.array(latLngSchema),
  // Meters, from OSM height/building:levels tags where present.
  height: z.number().positive().optional(),
});
export type BuildingInZone = z.infer<typeof buildingInZoneSchema>;

/** A cell's resolved building list (see POST /zones/buildings-in-cell). */
export const buildingsInZoneResponseSchema = z.array(buildingInZoneSchema);
export type BuildingsInZoneResponse = z.infer<typeof buildingsInZoneResponseSchema>;

export const buildingsInCellRequestSchema = z.object({
  cell: z.string(),
});
export type BuildingsInCellRequest = z.infer<typeof buildingsInCellRequestSchema>;

/** How dangerous an AREA_H3_RESOLUTION cell is — see dangerMath.ts's dangerTierFromValue. */
export const dangerTierSchema = z.enum(["safe", "slightly-dangerous", "very-dangerous", "off-limits"]);
export type DangerTier = z.infer<typeof dangerTierSchema>;

export const areaCellDangerSchema = z.object({
  cell: z.string(),
  tier: dangerTierSchema,
});
export type AreaCellDanger = z.infer<typeof areaCellDangerSchema>;

export const zonesInViewportRequestSchema = z.object({
  minLat: z.number(),
  minLng: z.number(),
  maxLat: z.number(),
  maxLng: z.number(),
});
export type ZonesInViewportRequest = z.infer<typeof zonesInViewportRequestSchema>;

/** Every non-safe-tier AREA_H3_RESOLUTION cell intersecting the viewport. */
export const zonesInViewportResponseSchema = z.array(areaCellDangerSchema);
export type ZonesInViewportResponse = z.infer<typeof zonesInViewportResponseSchema>;

const viewportBoundsSchema = z.object({
  minLat: z.number(),
  minLng: z.number(),
  maxLat: z.number(),
  maxLng: z.number(),
});

export const powerInfrastructureInViewportRequestSchema = viewportBoundsSchema;
export type PowerInfrastructureInViewportRequest = z.infer<typeof powerInfrastructureInViewportRequestSchema>;

/**
 * High-voltage transmission lines (OSM `power=line`, not the `power=minor_line`
 * distribution wiring strung along streets) and the lattice/monopole towers
 * (`power=tower`) that carry them.
 */
export const powerInfrastructureInViewportResponseSchema = z.object({
  lines: z.array(z.array(latLngSchema).min(2)),
  towers: z.array(latLngSchema),
});
export type PowerInfrastructureInViewportResponse = z.infer<typeof powerInfrastructureInViewportResponseSchema>;

/** Resolved, read-time view of a player: computed from their action history. */
export const playerStateSchema = z.object({
  player: playerSchema,
  /** Fixed at creation: the player's base/shelter. Doesn't move with travel. */
  basePosition: latLngSchema,
  /** The INTERACTION_H3_RESOLUTION cell the base occupies — basePosition is always this cell's center. */
  baseH3Cell: z.string(),
  // Null only for players created before base persistence existed — the hex was never
  // thrown away going forward, but old rows have no bases row to back-fill it from.
  baseGrid: hexGridResultSchema.nullable(),
  /** Current position: static when resting, interpolated while traveling. */
  position: latLngSchema,
  h3Cell: z.string(),
  personalClock: z.coerce.date(),
  activeAction: actionSchema.nullable(),
});
export type PlayerState = z.infer<typeof playerStateSchema>;
