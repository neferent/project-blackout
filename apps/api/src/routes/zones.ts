import { Hono } from "hono";
import {
  buildingsInZoneResponseSchema,
  createDangerZoneRequestSchema,
  createDangerZoneResponseSchema,
  zonesInViewportRequestSchema,
  zonesInViewportResponseSchema,
} from "@blackout/shared";
import { createDangerZone, findZoneBuildings, findZonesInViewport } from "../services/dangerZoneStore.js";

export const zonesRoute = new Hono();

/** Manual/dev spawn trigger for the POC — no automated spawner yet. */
zonesRoute.post("/", async (c) => {
  const body = createDangerZoneRequestSchema.parse(await c.req.json());
  const zone = await createDangerZone(body.center, body.bufferMeters);
  return c.json(createDangerZoneResponseSchema.parse(zone), 201);
});

/** Shapes only (not building data) for every zone intersecting the given viewport. */
zonesRoute.post("/in-viewport", async (c) => {
  const body = zonesInViewportRequestSchema.parse(await c.req.json());
  const zones = await findZonesInViewport(body);
  return c.json(zonesInViewportResponseSchema.parse(zones));
});

zonesRoute.get("/:id/buildings", async (c) => {
  const buildings = await findZoneBuildings(c.req.param("id"));
  return c.json(buildingsInZoneResponseSchema.parse(buildings));
});
