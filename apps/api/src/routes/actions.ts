import { Hono } from "hono";
import { sql } from "drizzle-orm";
import {
  actionSchema,
  realSecondsFromGameSeconds,
  gameSecondsForDistance,
  startTravelRequestSchema,
} from "@blackout/shared";
import { db } from "../db/client.js";
import { actions } from "../db/schema.js";
import { requireAnonKey } from "../identity/anonPlayer.js";
import { resolvePlayerState, hasActiveTrip } from "../state/playerState.js";
import { requestPedestrianRoute } from "../services/valhalla.js";
import { stubEncounterPlanner } from "../services/encounterPlanner.js";

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

  const { route, distanceKm } = await requestPedestrianRoute(state.position, body.destination);
  const encounters = await stubEncounterPlanner.planEncounters(route);

  const gameSeconds = gameSecondsForDistance(distanceKm);
  const realSeconds = realSecondsFromGameSeconds(gameSeconds);
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + realSeconds * 1000);

  const data = {
    origin: state.position,
    destination: body.destination,
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

actionsRoute.get("/current", requireAnonKey, async (c) => {
  const anonKey = c.get("anonKey");
  const state = await resolvePlayerState(anonKey);
  if (!state) {
    return c.json({ error: "Player not found" }, 404);
  }
  return c.json({ activeAction: state.activeAction, position: state.position });
});
