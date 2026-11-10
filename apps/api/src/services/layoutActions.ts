import { and, desc, eq, inArray } from "drizzle-orm";
import { layoutActionDataSchema, type LayoutActionData } from "@blackout/shared";
import { db } from "../db/client.js";
import { actions, baseTiles, bases, items, placements } from "../db/schema.js";
import { placementKind } from "./baseLayoutConfig.js";

export interface LayoutActionRow {
  id: string;
  startsAt: Date;
  endsAt: Date;
  data: LayoutActionData;
}

async function latestLayoutAction(playerId: string): Promise<LayoutActionRow | null> {
  const [row] = await db
    .select()
    .from(actions)
    .where(and(eq(actions.playerId, playerId), eq(actions.kind, "layout")))
    .orderBy(desc(actions.startsAt))
    .limit(1);
  if (!row) return null;
  return { id: row.id, startsAt: row.startsAt, endsAt: row.endsAt, data: layoutActionDataSchema.parse(row.data) };
}

/** The layout action still running (by server time), if any. */
export async function activeLayoutAction(playerId: string): Promise<LayoutActionRow | null> {
  const latest = await latestLayoutAction(playerId);
  return latest && latest.endsAt > new Date() ? latest : null;
}

/**
 * Lazily applies a finished layout action (same read-time pattern as finalizing a trip):
 * the first read after `endsAt` swaps the committed placements and bumps the layout
 * version. The version-conditional bump makes it idempotent under concurrent reads.
 */
export async function finalizeLayoutIfDone(playerId: string): Promise<void> {
  const latest = await latestLayoutAction(playerId);
  if (!latest || latest.endsAt > new Date()) return;
  const { data } = latest;

  await db.transaction(async (tx) => {
    const bumped = await tx
      .update(bases)
      .set({ layoutVersion: data.baseVersion + 1, layoutEfficiency: null })
      .where(and(eq(bases.id, data.baseId), eq(bases.layoutVersion, data.baseVersion)))
      .returning({ id: bases.id });
    if (bumped.length === 0) return; // already applied

    if (data.designations) {
      await tx.update(baseTiles).set({ designation: null }).where(eq(baseTiles.baseId, data.baseId));
      for (const d of data.designations) {
        await tx
          .update(baseTiles)
          .set({ designation: d.designation })
          .where(and(eq(baseTiles.baseId, data.baseId), eq(baseTiles.q, d.q), eq(baseTiles.r, d.r)));
      }
    }

    await tx.delete(placements).where(eq(placements.baseId, data.baseId));
    if (data.placements.length) {
      const defs = await tx
        .select({ id: items.id, definitionId: items.definitionId })
        .from(items)
        .where(inArray(items.id, data.placements.map((p) => p.itemId)));
      const defById = new Map(defs.map((d) => [d.id, d.definitionId]));
      await tx.insert(placements).values(
        data.placements.map((p) => ({
          baseId: data.baseId,
          itemId: p.itemId,
          q: p.q,
          r: p.r,
          facing: p.facing,
          kind: placementKind(defById.get(p.itemId)!),
        })),
      );
    }
  });
}
