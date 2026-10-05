import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  actionSchema,
  DISCONNECT_ACTION_GAME_SECONDS,
  DISCONNECT_MAX_DISTANCE_METERS,
  haversineKm,
  interactionCellCenter,
  interactionCellForPosition,
  realSecondsFromGameSeconds,
  gameSecondsForDistance,
  lineIntersectsPolygon,
  startDisconnectRequestSchema,
  startTravelRequestSchema,
  travelHistoryResponseSchema,
  type DisconnectActionData,
  type TravelActionData,
} from "@blackout/shared";
import { db } from "../db/client.js";
import { actions } from "../db/schema.js";
import { requireAnonKey } from "../identity/anonPlayer.js";
import { resolvePlayerState, hasActiveTrip } from "../state/playerState.js";
import { requestPedestrianRoute } from "../services/valhalla.js";
import { DANGER_FALLOFF_METERS } from "../services/dangerMath.js";
import {
  bboxAroundPoints,
  dangerProvider,
  DISCONNECTED_SAFE_RADIUS_METERS,
  invalidateAreaDangerCacheNear,
} from "../services/dangerProvider.js";
import { activeLayoutAction } from "../services/layoutActions.js";
import { stubEncounterPlanner } from "../services/encounterPlanner.js";
import { centroidOfOutline, findBuildingByOsmId, setBuildingConnectedToGrid } from "../services/buildingLookupCache.js";

export const actionsRoute = new Hono();

actionsRoute.post("/travel", requireAnonKey, async (c) => {
  const anonKey = c.get("anonKey");
  const body = startTravelRequestSchema.parse(await c.req.json());

  const state = await resolvePlayerState(anonKey);
  if (!state) {
    return c.json({ error: "Player not found" }, 404);
  }
  if (await hasActiveTrip(state.player.id)) {
    return c.json({ error: "Player already has an active trip" }, 409);
  }
  // Rearranging the base occupies the player entirely — nothing else can start.
  if (await activeLayoutAction(state.player.id)) {
    return c.json({ error: "Player is busy rearranging their base" }, 409);
  }

  // Authoritative "which hex did you actually pick" — independent of whatever
  // raw point the client sent. Trips always resolve hex-center to hex-center.
  const destination = interactionCellCenter(interactionCellForPosition(body.destination));

  // Routing goes through DangerProvider before touching Valhalla. If the direct
  // route crosses a known danger zone and the player asked for the avoiding
  // route (the default — see startTravelRequestSchema), swap in a route with
  // that zone excluded. "direct" is honored even if it cuts through danger —
  // that's the player's explicit choice.
  const bbox = bboxAroundPoints([state.position, destination], DANGER_FALLOFF_METERS);
  const dangerZones = await dangerProvider.dangerZones(bbox);
  let { route, distanceKm } = await requestPedestrianRoute(state.position, destination);
  const crossedZones = dangerZones.filter((zone) => lineIntersectsPolygon(route.coordinates, zone));
  if (crossedZones.length > 0 && body.routeChoice === "avoiding") {
    const avoided = await requestPedestrianRoute(state.position, destination, crossedZones);
    if (!crossedZones.some((zone) => lineIntersectsPolygon(avoided.route.coordinates, zone))) {
      route = avoided.route;
      distanceKm = avoided.distanceKm;
    }
  }

  const encounters = await stubEncounterPlanner.planEncounters(route);

  const gameSeconds = gameSecondsForDistance(distanceKm);
  const realSeconds = realSecondsFromGameSeconds(gameSeconds);
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + realSeconds * 1000);

  const data = {
    origin: state.position,
    destination,
    route,
    distanceKm,
    encounters,
  };

  const [inserted] = await db
    .insert(actions)
    .values({
      playerId: state.player.id,
      kind: "travel",
      route: sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(route)}), 4326)`,
      startsAt,
      endsAt,
      data,
    })
    .returning();

  return c.json(actionSchema.parse({ ...inserted, data }), 201);
});

actionsRoute.post("/disconnect", requireAnonKey, async (c) => {
  const anonKey = c.get("anonKey");
  const body = startDisconnectRequestSchema.parse(await c.req.json());

  const state = await resolvePlayerState(anonKey);
  if (!state) {
    return c.json({ error: "Player not found" }, 404);
  }

  if (await activeLayoutAction(state.player.id)) {
    return c.json({ error: "Player is busy rearranging their base" }, 409);
  }

  const building = await findBuildingByOsmId(body.osmType, body.osmId);
  if (!building) {
    return c.json({ error: "Building not found — look it up first" }, 404);
  }
  if (!building.connectedToGrid) {
    return c.json({ error: "Building is already disconnected" }, 409);
  }

  const position = centroidOfOutline(building.outline);
  const distanceM = haversineKm(state.position, position) * 1000;
  if (distanceM > DISCONNECT_MAX_DISTANCE_METERS) {
    return c.json({ error: "Too far from the building to disconnect it" }, 400);
  }

  const realSeconds = realSecondsFromGameSeconds(DISCONNECT_ACTION_GAME_SECONDS);
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + realSeconds * 1000);

  const data: DisconnectActionData = {
    buildingOsmType: body.osmType,
    buildingOsmId: body.osmId,
    position,
  };

  const [inserted] = await db
    .insert(actions)
    .values({
      playerId: state.player.id,
      kind: "disconnect",
      startsAt,
      endsAt,
      data,
    })
    .returning();

  // Applied immediately rather than deferred to endsAt: this is a discrete
  // one-time state flip, not a value resolved from elapsed time like position/
  // clock are (see CLAUDE.md's server-time rule) — the action's duration only
  // occupies the personal clock, per gameDurationSeconds in disconnect.ts.
  await setBuildingConnectedToGrid(body.osmType, body.osmId, false);
  // The disconnect can turn cached-dangerous cells near this building safe — see
  // invalidateAreaDangerCacheNear's doc comment.
  await invalidateAreaDangerCacheNear(position, DISCONNECTED_SAFE_RADIUS_METERS);

  return c.json(actionSchema.parse({ ...inserted, data }), 201);
});

actionsRoute.get("/current", requireAnonKey, async (c) => {
  const anonKey = c.get("anonKey");
  const state = await resolvePlayerState(anonKey);
  if (!state) {
    return c.json({ error: "Player not found" }, 404);
  }
  return c.json({ activeAction: state.activeAction, position: state.position });
});

const TRAVEL_HISTORY_LIMIT = 5;

/** The most recent completed trips' routes, for faded breadcrumbs of where the player's been. */
actionsRoute.get("/history", requireAnonKey, async (c) => {
  const anonKey = c.get("anonKey");
  const state = await resolvePlayerState(anonKey);
  if (!state) {
    return c.json({ error: "Player not found" }, 404);
  }

  const now = new Date();
  const rows = await db
    .select()
    .from(actions)
    .where(and(eq(actions.playerId, state.player.id), eq(actions.kind, "travel")))
    .orderBy(desc(actions.startsAt))
    .limit(TRAVEL_HISTORY_LIMIT + 1); // +1: the in-progress trip (if any) is excluded below, not counted against the limit

  const completed = rows.filter((a) => a.endsAt <= now).slice(0, TRAVEL_HISTORY_LIMIT);

  return c.json(
    travelHistoryResponseSchema.parse(
      completed.map((a) => ({ id: a.id, route: (a.data as TravelActionData).route, endsAt: a.endsAt })),
    ),
  );
});
