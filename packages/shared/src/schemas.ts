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

export const createPlayerRequestSchema = z.object({
  position: latLngSchema,
});
export type CreatePlayerRequest = z.infer<typeof createPlayerRequestSchema>;

/**
 * Action kinds. The registry is built to accept more (scavenge, craft, rest, ...)
 * without changing this list's consumers.
 */
export const actionKindSchema = z.enum(["travel", "disconnect"]);
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

/** A zone's persisted building list (see GET /zones/:id/buildings). */
export const buildingsInZoneResponseSchema = z.array(buildingInZoneSchema);
export type BuildingsInZoneResponse = z.infer<typeof buildingsInZoneResponseSchema>;

/** A spawned danger zone's shape — all a client needs to render it. */
export const dangerZoneShapeSchema = z.object({
  id: z.string().uuid(),
  // A closed ring (first point repeated as last).
  polygon: z.array(latLngSchema).min(4),
});
export type DangerZoneShape = z.infer<typeof dangerZoneShapeSchema>;

export const zonesInViewportRequestSchema = z.object({
  minLat: z.number(),
  minLng: z.number(),
  maxLat: z.number(),
  maxLng: z.number(),
});
export type ZonesInViewportRequest = z.infer<typeof zonesInViewportRequestSchema>;

export const zonesInViewportResponseSchema = z.array(dangerZoneShapeSchema);
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

export const createDangerZoneRequestSchema = z.object({
  center: latLngSchema,
  // How far outside the zone's boundary to also resolve+persist buildings.
  bufferMeters: z.number().nonnegative().default(50),
});
export type CreateDangerZoneRequest = z.infer<typeof createDangerZoneRequestSchema>;

export const createDangerZoneResponseSchema = dangerZoneShapeSchema.extend({
  buildingCount: z.number().int().nonnegative(),
});
export type CreateDangerZoneResponse = z.infer<typeof createDangerZoneResponseSchema>;

/** Resolved, read-time view of a player: computed from their action history. */
export const playerStateSchema = z.object({
  player: playerSchema,
  /** Fixed at creation: the player's base/shelter. Doesn't move with travel. */
  basePosition: latLngSchema,
  /** Current position: static when resting, interpolated while traveling. */
  position: latLngSchema,
  h3Cell: z.string(),
  personalClock: z.coerce.date(),
  activeAction: actionSchema.nullable(),
});
export type PlayerState = z.infer<typeof playerStateSchema>;
