import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { bases, items } from "../db/schema.js";

/** Definition ids every new player starts with (one each; two of each attachment). */
const STARTER_KIT: { definitionId: string; count: number }[] = [
  { definitionId: "door", count: 1 },
  { definitionId: "forge", count: 1 },
  { definitionId: "anvil", count: 1 },
  { definitionId: "workbench", count: 1 },
  { definitionId: "still", count: 1 },
  { definitionId: "garden_plot", count: 1 },
  { definitionId: "storage_shelf", count: 1 },
  { definitionId: "vice", count: 2 },
  { definitionId: "tool_rack", count: 2 },
  { definitionId: "bellows", count: 1 },
  { definitionId: "quench_barrel", count: 1 },
  { definitionId: "grindstone", count: 1 },
  { definitionId: "lamp", count: 2 },
];

const randomQuality = () => Math.round((20 + Math.random() * 30) * 100) / 100;

/**
 * STUB for item acquisition (scavenging/crafting/trading don't exist yet): grants a
 * starter kit once per base, lazily on first base read so pre-existing players get it
 * too. Real acquisition replaces this; item instances (quality, owner) stay the same.
 */
export async function ensureStarterKit(playerId: string, baseId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Claim the grant first, conditionally, so concurrent first reads can't double-grant.
    const claimed = await tx
      .update(bases)
      .set({ starterKitGranted: true })
      .where(and(eq(bases.id, baseId), eq(bases.starterKitGranted, false)))
      .returning({ id: bases.id });
    if (claimed.length === 0) return;

    const rows = STARTER_KIT.flatMap(({ definitionId, count }) =>
      Array.from({ length: count }, () => ({
        ownerPlayerId: playerId,
        definitionId,
        quality: randomQuality().toFixed(2),
      })),
    );
    await tx.insert(items).values(rows);
  });
}
