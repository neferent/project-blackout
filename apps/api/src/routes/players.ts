import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { createPlayerRequestSchema, playerStateSchema } from "@blackout/shared";
import { db } from "../db/client.js";
import { players } from "../db/schema.js";
import { cellForPosition } from "../lib/h3.js";
import { requireAnonKey } from "../identity/anonPlayer.js";
import { resolvePlayerState } from "../state/playerState.js";

export const playersRoute = new Hono();

playersRoute.post("/", requireAnonKey, async (c) => {
  const anonKey = c.get("anonKey");
  const body = createPlayerRequestSchema.parse(await c.req.json());

  const existing = await resolvePlayerState(anonKey);
  if (existing) {
    return c.json(playerStateSchema.parse(existing));
  }

  const cell = cellForPosition(body.position);
  await db.execute(sql`
    insert into ${players} (anon_key, position, current_h3_cell, base_lat, base_lng)
    values (
      ${anonKey},
      ST_SetSRID(ST_MakePoint(${body.position.lng}, ${body.position.lat}), 4326),
      ${cell},
      ${body.position.lat},
      ${body.position.lng}
    )
  `);

  const state = await resolvePlayerState(anonKey);
  return c.json(playerStateSchema.parse(state), 201);
});

playersRoute.get("/me", requireAnonKey, async (c) => {
  const anonKey = c.get("anonKey");
  const state = await resolvePlayerState(anonKey);
  if (!state) {
    return c.json({ error: "Player not found" }, 404);
  }
  return c.json(playerStateSchema.parse(state));
});
