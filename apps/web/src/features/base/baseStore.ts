import { defineStore } from "pinia";
import { ref } from "vue";
import type { BaseLayoutState } from "@blackout/shared";
import { apiClient } from "../../api/client.js";

export const useBaseStore = defineStore("base", () => {
  const state = ref<BaseLayoutState | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let finishTimer: ReturnType<typeof setTimeout> | undefined;

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      state.value = await apiClient.get<BaseLayoutState>("/base");
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Couldn't load your base";
    } finally {
      loading.value = false;
    }
    scheduleFinishReload();
  }

  // The server applies a finished layout lazily on the next read, so re-read right after
  // the running action's end time (server clock; the client just waits it out).
  function scheduleFinishReload() {
    clearTimeout(finishTimer);
    const active = state.value?.activeLayoutAction;
    if (!active) return;
    const wait = Math.max(0, new Date(active.endsAt).getTime() - Date.now()) + 750;
    finishTimer = setTimeout(load, wait);
  }

  function reset() {
    clearTimeout(finishTimer);
    state.value = null;
    error.value = null;
  }

  return { state, loading, error, load, reset };
});
