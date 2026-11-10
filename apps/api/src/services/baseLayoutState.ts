import { eq } from "drizzle-orm";
import {
  designationSchema,
  evaluateLayout,
  tileTypeSchema,
  type BaseLayoutState,
  type LayoutEvaluation,
  type LayoutInput,
  type TileType,
} from "@blackout/shared";
import { db } from "../db/client.js";
import { baseTiles, bases, items, placements, players } from "../db/schema.js";
import { getBaseLayoutConfig } from "./baseLayoutConfig.js";
import { activeLayoutAction, finalizeLayoutIfDone } from "./layoutActions.js";
import { ensureStarterKit } from "./itemGrantProvider.js";

/** Loads a player's committed layout (+ cached evaluation). Null if they have no base. */
export async function loadBaseLayoutState(anonKey: string): Promise<BaseLayoutState | null> {
  const [row] = await db
    .select({ playerId: players.id, base: bases })
    .from(players)
    .innerJoin(bases, eq(bases.playerId, players.id))
    .where(eq(players.anonKey, anonKey))
    .limit(1);
  if (!row) return null;
  const { playerId } = row;
  let base = row.base;

  await finalizeLayoutIfDone(playerId);
  base = (await db.select().from(bases).where(eq(bases.id, base.id)).limit(1))[0];
  if (!base.starterKitGranted) await ensureStarterKit(playerId, base.id);

  const [tileRows, placementRows, itemRows] = await Promise.all([
    db.select().from(baseTiles).where(eq(baseTiles.baseId, base.id)),
    db.select().from(placements).where(eq(placements.baseId, base.id)),
    db.select().from(items).where(eq(items.ownerPlayerId, playerId)),
  ]);

  const tiles = tileRows.map((t) => ({
    q: t.q,
    r: t.r,
    tileType: tileTypeSchema.parse(t.tileType) as TileType,
    convertedFrom: t.convertedFrom ? (tileTypeSchema.parse(t.convertedFrom) as TileType) : null,
    designation: t.designation ? designationSchema.parse(t.designation) : null,
  }));
  const itemMap = Object.fromEntries(
    itemRows.map((i) => [i.id, { definitionId: i.definitionId, quality: Number(i.quality) }]),
  );
  const layoutPlacements = placementRows.map((p) => ({ itemId: p.itemId, q: p.q, r: p.r, facing: p.facing }));

  const config = getBaseLayoutConfig();
  let evaluation = base.layoutEfficiency as LayoutEvaluation | null;
  if (!evaluation) {
    const input: LayoutInput = { tiles, placements: layoutPlacements, items: itemMap };
    evaluation = evaluateLayout(config, input);
    await db.update(bases).set({ layoutEfficiency: evaluation }).where(eq(bases.id, base.id));
  }

  const active = await activeLayoutAction(playerId);

  return {
    baseId: base.id,
    layoutVersion: base.layoutVersion,
    tiles,
    placements: layoutPlacements,
    items: itemMap,
    evaluation,
    activeLayoutAction: active
      ? {
          id: active.id,
          startsAt: active.startsAt.toISOString(),
          endsAt: active.endsAt.toISOString(),
          hours: active.data.hours,
          placements: active.data.placements,
          designations: active.data.designations,
        }
      : null,
  };
}
