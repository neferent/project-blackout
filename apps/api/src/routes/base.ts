import { Hono } from "hono";
import {
  actionSchema,
  commitLayoutRequestSchema,
  interactionCellForPosition,
  planLayoutCommit,
  realSecondsFromGameSeconds,
  type LayoutActionData,
} from "@blackout/shared";
import { db } from "../db/client.js";
import { actions } from "../db/schema.js";
import { requireAnonKey } from "../identity/anonPlayer.js";
import { resolvePlayerState } from "../state/playerState.js";
import { loadBaseLayoutState } from "../services/baseLayoutState.js";
import { getBaseLayoutConfig } from "../services/baseLayoutConfig.js";

export const baseRoute = new Hono();

baseRoute.get("/", requireAnonKey, async (c) => {
  const state = await loadBaseLayoutState(c.get("anonKey"));
  if (!state) return c.json({ error: "Base not found" }, 404);
  return c.json(state);
});

baseRoute.post("/layout/commit", requireAnonKey, async (c) => {
  const anonKey = c.get("anonKey");
  const body = commitLayoutRequestSchema.parse(await c.req.json());

  const player = await resolvePlayerState(anonKey);
  if (!player) return c.json({ error: "Player not found" }, 404);

  // Any action in progress (travel or an earlier layout) means the player is busy.
  if (player.activeAction) return c.json({ error: "Player is busy with another action" }, 409);
  if (interactionCellForPosition(player.position) !== player.baseH3Cell) {
    return c.json({ error: "You must be at your base to rearrange it" }, 409);
  }

  // Loading finalizes any finished layout action first, so the version check below is current.
  const base = await loadBaseLayoutState(anonKey);
  if (!base) return c.json({ error: "Base not found" }, 404);
  if (base.activeLayoutAction) return c.json({ error: "A layout change is already in progress" }, 409);
  if (body.baseVersion !== base.layoutVersion) {
    return c.json({ error: "Layout changed since you planned it — reload and try again" }, 409);
  }

  const plan = planLayoutCommit(getBaseLayoutConfig(), {
    tiles: base.tiles,
    items: base.items,
    current: base.placements,
    requested: body.placements,
  });
  if (!plan.ok) {
    return plan.reason === "invalid"
      ? c.json({ error: "Invalid layout", details: plan.errors }, 400)
      : c.json({ error: "No changes to commit" }, 400);
  }

  const realSeconds = realSecondsFromGameSeconds(plan.gameSeconds);
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + realSeconds * 1000);
  const data: LayoutActionData = {
    baseId: base.baseId,
    baseVersion: base.layoutVersion,
    placements: body.placements,
    hours: plan.cost.hours,
    gameSeconds: plan.gameSeconds,
  };

  const [inserted] = await db
    .insert(actions)
    .values({ playerId: player.player.id, kind: "layout", startsAt, endsAt, data })
    .returning();

  return c.json(actionSchema.parse({ ...inserted, data }), 201);
});
