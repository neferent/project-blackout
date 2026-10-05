import { Hono } from "hono";
import { buildingsInCellRequestSchema, buildingsInZoneResponseSchema, zonesInViewportRequestSchema, zonesInViewportResponseSchema } from "@blackout/shared";
import { dangerProvider } from "../services/dangerProvider.js";
import { findOrFetchBuildingsInCell } from "../services/areaDangerBuildingsCache.js";

export const zonesRoute = new Hono();

/** Every non-safe-tier AREA_H3_RESOLUTION cell intersecting the given viewport. */
zonesRoute.post("/in-viewport", async (c) => {
  const body = zonesInViewportRequestSchema.parse(await c.req.json());
  const cells = await dangerProvider.tiersInViewport(body);
  return c.json(zonesInViewportResponseSchema.parse(cells));
});

/**
 * Buildings within one AREA_H3_RESOLUTION cell — served from the DB cache
 * after the first resolve (see areaDangerBuildingsCache.ts), never a live
 * Overpass call on a cache hit. Callers should only query cells they intend
 * to show building highlights for (e.g. off-limits tier) — not every cell in
 * a viewport, to stay within Overpass's self-throttle on a cold cell.
 */
zonesRoute.post("/buildings-in-cell", async (c) => {
  const body = buildingsInCellRequestSchema.parse(await c.req.json());
  const buildings = await findOrFetchBuildingsInCell(body.cell);
  return c.json(buildingsInZoneResponseSchema.parse(buildings));
});
