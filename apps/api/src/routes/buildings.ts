import { Hono } from "hono";
import { buildingLookupRequestSchema, buildingLookupResponseSchema } from "@blackout/shared";
import { findCachedBuilding, cacheBuilding } from "../services/buildingLookupCache.js";
import { queryOverpassBuilding } from "../services/overpass.js";

export const buildingsRoute = new Hono();

buildingsRoute.post("/lookup", async (c) => {
  const body = buildingLookupRequestSchema.parse(await c.req.json());

  const cached = await findCachedBuilding(body.position);
  if (cached) return c.json(buildingLookupResponseSchema.parse(cached));

  const found = await queryOverpassBuilding(body.position);
  if (found) await cacheBuilding(found);

  return c.json(buildingLookupResponseSchema.parse(found));
});
