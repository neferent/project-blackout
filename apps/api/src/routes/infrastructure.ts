import { Hono } from "hono";
import { powerInfrastructureInViewportRequestSchema, powerInfrastructureInViewportResponseSchema } from "@blackout/shared";
import { ensurePowerInfrastructureFetched, findPowerInfrastructureInViewport } from "../services/powerInfrastructureCache.js";

export const infrastructureRoute = new Hono();

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
