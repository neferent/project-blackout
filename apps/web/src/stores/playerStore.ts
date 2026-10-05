import { defineStore } from "pinia";
import { ref } from "vue";
import { playerStateSchema, type HexGridResult, type PlayerState } from "@blackout/shared";
import { apiClient } from "../api/client.js";
import { clearAnonPlayerKey } from "../identity/anonPlayerId.js";

export const usePlayerStore = defineStore("player", () => {
  const state = ref<PlayerState | null>(null);
  const loaded = ref(false);

  async function refresh(): Promise<PlayerState | null> {
    try {
      // Parsed (not just cast): startsAt/endsAt must become real Date objects here,
      // or tripProgress() throws on a string and silently kills the animation loop.
      state.value = playerStateSchema.parse(await apiClient.get("/players/me"));
    } catch {
      state.value = null;
    } finally {
      loaded.value = true;
    }
    return state.value;
  }

  async function create(position: { lat: number; lng: number }, grid: HexGridResult): Promise<PlayerState> {
    state.value = playerStateSchema.parse(await apiClient.post("/players", { position, grid }));
    return state.value;
  }

  // POC-only testing helper: wipes the current anonymous player server-side (cascades
  // to their actions/base) and forgets the anon key, so the next request mints a fresh
  // one and StartPicker starts over. See anonPlayerId.ts for the identity scheme.
  async function reset(): Promise<void> {
    await apiClient.delete("/players/me").catch(() => {});
    clearAnonPlayerKey();
    state.value = null;
  }

  return { state, loaded, refresh, create, reset };
});
