import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  evaluateLayout,
  placeItem,
  planLayoutCommit,
  removePlacement,
  rotatePlacement,
  SEED_BASE_LAYOUT_CONFIG,
  validateLayout,
  validDropTiles,
  type LayoutPlacement,
} from "@blackout/shared";
import { apiClient } from "../../api/client.js";
import { useBaseStore } from "./baseStore.js";

/** The api client throws "POST path failed: 409 {json}" — pull the server's message out. */
function commitErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : "";
  const json = raw.slice(raw.indexOf("{"));
  try {
    const body = JSON.parse(json) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // fall through
  }
  return "Couldn't commit the layout";
}

/**
 * Plan mode: a client-only, free-to-edit copy of the layout. Nothing here touches the
 * server — the same shared rule functions the server re-runs on commit drive the live
 * preview. The rule config is the seed imported from shared (same object the server's
 * getBaseLayoutConfig returns today).
 */
export const useLayoutDraftStore = defineStore("layoutDraft", () => {
  const baseStore = useBaseStore();
  const config = SEED_BASE_LAYOUT_CONFIG;

  const placements = ref<LayoutPlacement[]>([]);
  /** Last rejected edit, shown briefly in the panel. */
  const message = ref<string | null>(null);

  const tiles = computed(() => baseStore.state?.tiles ?? []);
  const items = computed(() => baseStore.state?.items ?? {});
  const committed = computed(() => baseStore.state?.placements ?? []);

  const input = computed(() => ({ tiles: tiles.value, items: items.value, placements: placements.value }));

  const evaluation = computed(() => evaluateLayout(config, input.value));
  const errors = computed(() => validateLayout(config, input.value));

  const placedIds = computed(() => new Set(placements.value.map((p) => p.itemId)));
  const unplacedItemIds = computed(() => Object.keys(items.value).filter((id) => !placedIds.value.has(id)));

  const dirty = computed(() => {
    const key = (p: LayoutPlacement) => `${p.itemId}:${p.q}:${p.r}:${p.facing}`;
    const a = placements.value.map(key).sort().join("|");
    const b = committed.value.map(key).sort().join("|");
    return a !== b;
  });

  /** What committing would do and cost right now (the server recomputes this itself). */
  const plan = computed(() =>
    planLayoutCommit(config, {
      tiles: tiles.value,
      items: items.value,
      current: committed.value,
      requested: placements.value,
    }),
  );
  const costHours = computed(() => (plan.value.ok ? plan.value.cost.hours : 0));

  const committing = ref(false);

  async function commit(): Promise<boolean> {
    if (committing.value || !plan.value.ok) return false;
    committing.value = true;
    message.value = null;
    try {
      await apiClient.post("/base/layout/commit", {
        baseVersion: baseStore.state?.layoutVersion ?? 0,
        placements: placements.value,
      });
      // Reloading picks up the running action, which locks the panel.
      await baseStore.load();
      return true;
    } catch (e) {
      message.value = commitErrorMessage(e);
      // A stale version or busy player: refresh so the next attempt starts from server truth.
      await baseStore.load();
      return false;
    } finally {
      committing.value = false;
    }
  }

  /** Reset the draft to the committed layout (also the Discard action). */
  function resetToCommitted() {
    placements.value = committed.value.map((p) => ({ ...p }));
    message.value = null;
  }

  function place(itemId: string, at: { q: number; r: number }): boolean {
    const result = placeItem(config, input.value, itemId, at);
    if (!result.ok) {
      message.value = result.message;
      return false;
    }
    placements.value = result.placements;
    message.value = null;
    return true;
  }

  function rotate(itemId: string) {
    placements.value = rotatePlacement(placements.value, itemId);
  }

  function remove(itemId: string) {
    placements.value = removePlacement(placements.value, itemId);
  }

  function dropTargets(itemId: string) {
    return validDropTiles(config, input.value, itemId);
  }

  return {
    config,
    placements,
    message,
    tiles,
    items,
    committed,
    evaluation,
    errors,
    plan,
    costHours,
    committing,
    commit,
    unplacedItemIds,
    dirty,
    resetToCommitted,
    place,
    rotate,
    remove,
    dropTargets,
  };
});
