import { Hono } from "hono";
import { gameSecondsForDistance, realSecondsFromGameSeconds, routePreviewRequestSchema, routePreviewResponseSchema } from "@blackout/shared";
import { requestPedestrianRoute } from "../services/valhalla.js";
import { stubDangerProvider } from "../services/dangerProvider.js";

export const routesRoute = new Hono();

routesRoute.post("/preview", async (c) => {
  const body = routePreviewRequestSchema.parse(await c.req.json());

  // Routing goes through DangerProvider so avoid-zones/costs can be wired in later.
  await stubDangerProvider.dangerForCell("");

  const { route, distanceKm } = await requestPedestrianRoute(body.origin, body.destination);
  const gameSeconds = gameSecondsForDistance(distanceKm);
  const realSeconds = realSecondsFromGameSeconds(gameSeconds);

  return c.json(routePreviewResponseSchema.parse({ route, distanceKm, gameSeconds, realSeconds }));
});
