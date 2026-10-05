import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  createPlayerRequestSchema,
  interactionCellCenter,
  interactionCellForPosition,
  MIN_BASE_BUILDING_CELLS,
  playerStateSchema,
} from "@blackout/shared";
import { db } from "../db/client.js";
import { bases, players } from "../db/schema.js";
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

  // Same hard minimum the client enforces (hexGridWarning) — never trust the client
  // alone to have actually applied it before sending the grid.
  const buildingCells = body.grid.cells.filter((cell) => cell.classification === "building").length;
  if (buildingCells < MIN_BASE_BUILDING_CELLS) {
    return c.json({ error: "Chosen hex doesn't have enough buildings to found a base" }, 400);
  }

  // Resting position is always a hex center by construction (see playerState.ts) —
  // start the player at their base hex's center, not the raw point they clicked.
  const baseCell = interactionCellForPosition(body.position);
  const basePosition = interactionCellCenter(baseCell);
  const cell = cellForPosition(basePosition);

  await db.transaction(async (tx) => {
    const [player] = await tx.execute<{ id: string }>(sql`
      insert into ${players} (anon_key, position, current_h3_cell, base_h3_cell)
      values (
        ${anonKey},
        ST_SetSRID(ST_MakePoint(${basePosition.lng}, ${basePosition.lat}), 4326),
        ${cell},
        ${baseCell}
      )
      returning id
    `);
    await tx.insert(bases).values({
      playerId: player.id,
      hexCell: baseCell,
      radius: body.grid.radius,
      gridData: body.grid,
    });
  });

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

// POC-only: lets a tester wipe their own anonymous player (and everything that
// cascades from it — actions, base) to restart start-point selection from scratch.
// Identity is anon-key-in-a-header for the POC, so this is a self-service delete,
// not an admin operation — no stronger auth to check here (see anonPlayer.ts).
playersRoute.delete("/me", requireAnonKey, async (c) => {
  const anonKey = c.get("anonKey");
  await db.delete(players).where(eq(players.anonKey, anonKey));
  return c.body(null, 204);
});
