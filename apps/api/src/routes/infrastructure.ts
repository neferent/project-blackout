import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { powerInfrastructureInViewportRequestSchema, powerInfrastructureInViewportResponseSchema } from "@blackout/shared";
import { ensurePowerInfrastructureFetched, findPowerInfrastructureInViewport } from "../services/powerInfrastructureCache.js";
import { db } from "../db/client.js";

export const infrastructureRoute = new Hono();

/**
 * Debug probe only, for checking H3 hex coverage against the BC power
 * infrastructure import (powerSubstations/powerPlants in schema.ts) — not
 * part of any game feature. Returns every point (position, or footprint
 * centroid when the source feature was mapped as a polygon) with no
 * viewport filtering, since the whole point is to see all of them at once.
 */
async function allPoints(table: "power_substations" | "power_plants"): Promise<{ lat: number; lng: number }[]> {
  const rows = await db.execute<{ lat: number; lng: number }>(sql`
    select ST_Y(coalesce(position, ST_Centroid(footprint))) as lat,
           ST_X(coalesce(position, ST_Centroid(footprint))) as lng
    from ${sql.raw(table)}
    where position is not null or footprint is not null
  `);
  return rows.map((r) => ({ lat: r.lat, lng: r.lng }));
}

infrastructureRoute.get("/power-lines/substations", async (c) => {
  return c.json({ substations: await allPoints("power_substations") });
});

infrastructureRoute.get("/power-lines/plants", async (c) => {
  return c.json({ plants: await allPoints("power_plants") });
});

infrastructureRoute.post("/power-lines/in-viewport", async (c) => {
  const body = powerInfrastructureInViewportRequestSchema.parse(await c.req.json());

  // Only hits Overpass for tiles covering this viewport that have never been fetched
  // before — see powerInfrastructureCache.ts. Once fetched, a tile is served from Postgres
  // forever, no re-query on later visits to the same area.
  const ok = await ensurePowerInfrastructureFetched(body);
  // false means an Overpass call needed to fill a gap failed/timed out (distinct from a
  // genuinely empty area) — a 503 tells the client to keep whatever it already rendered
  // rather than blanking the layer out on a transient failure.
  if (!ok) return c.json({ error: "power infrastructure query failed" }, 503);

  const found = await findPowerInfrastructureInViewport(body);
  return c.json(powerInfrastructureInViewportResponseSchema.parse(found));
});
