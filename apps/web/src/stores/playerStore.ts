import { defineStore } from "pinia";
import { ref } from "vue";
import { playerStateSchema, type PlayerState } from "@blackout/shared";
import { apiClient } from "../api/client.js";

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

  async function create(position: { lat: number; lng: number }): Promise<PlayerState> {
    state.value = playerStateSchema.parse(await apiClient.post("/players", { position }));
    return state.value;
  }

  return { state, loaded, refresh, create };
});
