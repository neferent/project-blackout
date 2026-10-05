import { Hono } from "hono";
import {
  gameSecondsForDistance,
  interactionCellCenter,
  interactionCellForPosition,
  lineIntersectsPolygon,
  realSecondsFromGameSeconds,
  routePreviewRequestSchema,
  routePreviewResponseSchema,
} from "@blackout/shared";
import { DANGER_FALLOFF_METERS } from "../services/dangerMath.js";
import { requestPedestrianRoute } from "../services/valhalla.js";
import { bboxAroundPoints, dangerProvider } from "../services/dangerProvider.js";

export const routesRoute = new Hono();

routesRoute.post("/preview", async (c) => {
  const body = routePreviewRequestSchema.parse(await c.req.json());
  // Authoritative "which hex did you actually pick" — independent of whatever
  // raw point the client sent. Trips always resolve hex-center to hex-center.
  const destination = interactionCellCenter(interactionCellForPosition(body.destination));

  // Routing goes through DangerProvider before touching Valhalla.
  const bbox = bboxAroundPoints([body.origin, destination], DANGER_FALLOFF_METERS);
  const dangerZones = await dangerProvider.dangerZones(bbox);

  const { route, distanceKm } = await requestPedestrianRoute(body.origin, destination);
  const gameSeconds = gameSecondsForDistance(distanceKm);
  const realSeconds = realSecondsFromGameSeconds(gameSeconds);

  const crossedZones = dangerZones.filter((zone) => lineIntersectsPolygon(route.coordinates, zone));

  let avoidingDanger = null;
  if (crossedZones.length > 0) {
    const avoided = await requestPedestrianRoute(body.origin, destination, crossedZones);
    // Excluding a zone can still leave Valhalla no choice but to cut through it
    // (e.g. it's the only way in/out) — only report an alternative that's
    // actually clear of every zone it was asked to avoid.
    if (!crossedZones.some((zone) => lineIntersectsPolygon(avoided.route.coordinates, zone))) {
      const avoidingGameSeconds = gameSecondsForDistance(avoided.distanceKm);
      avoidingDanger = {
        route: avoided.route,
        distanceKm: avoided.distanceKm,
        gameSeconds: avoidingGameSeconds,
        realSeconds: realSecondsFromGameSeconds(avoidingGameSeconds),
      };
    }
  }

  return c.json(routePreviewResponseSchema.parse({ route, distanceKm, gameSeconds, realSeconds, avoidingDanger }));
});
