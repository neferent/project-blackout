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
 * Action kinds. Only "travel" is implemented in the POC; the registry is built
 * to accept more (scavenge, craft, rest, ...) without changing this list's consumers.
 */
export const actionKindSchema = z.enum(["travel"]);
export type ActionKind = z.infer<typeof actionKindSchema>;

export const travelActionDataSchema = z.object({
  origin: latLngSchema,
  destination: latLngSchema,
  route: lineStringSchema,
  distanceKm: z.number().positive(),
});
export type TravelActionData = z.infer<typeof travelActionDataSchema>;

export const actionSchema = z.object({
  id: z.string().uuid(),
  playerId: z.string().uuid(),
  kind: actionKindSchema,
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  data: z.unknown(),
});
export type Action = z.infer<typeof actionSchema>;

export const routePreviewRequestSchema = z.object({
  origin: latLngSchema,
  destination: latLngSchema,
});
export type RoutePreviewRequest = z.infer<typeof routePreviewRequestSchema>;

export const routePreviewResponseSchema = z.object({
  route: lineStringSchema,
  distanceKm: z.number().positive(),
  gameSeconds: z.number().positive(),
  realSeconds: z.number().positive(),
});
export type RoutePreviewResponse = z.infer<typeof routePreviewResponseSchema>;

export const startTravelRequestSchema = z.object({
  destination: latLngSchema,
});
export type StartTravelRequest = z.infer<typeof startTravelRequestSchema>;

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
