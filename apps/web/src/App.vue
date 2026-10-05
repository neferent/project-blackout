<script setup lang="ts">
import { onMounted, ref } from "vue";
import MapView from "./map/MapView.vue";
import StartPicker from "./features/placement/StartPicker.vue";
import TravelPanel from "./features/travel/TravelPanel.vue";
import { usePlayerStore } from "./stores/playerStore.js";

const playerStore = usePlayerStore();
const ready = ref(false);
const resetting = ref(false);

onMounted(async () => {
  await playerStore.refresh();
  ready.value = true;
});

async function resetPlayer() {
  if (!confirm("Reset your saved player data? This deletes your base and travel history.")) return;
  resetting.value = true;
  try {
    await playerStore.reset();
  } finally {
    resetting.value = false;
  }
}
</script>

<template>
  <MapView />
  <template v-if="ready">
    <StartPicker v-if="!playerStore.state" @placed="() => {}" />
    <TravelPanel v-else />
  </template>
  <!-- POC-only testing helper: wipes the anon player so you can re-pick a start hex. -->
  <button class="reset-player" :disabled="resetting" @click="resetPlayer">
    {{ resetting ? "Resetting…" : "Reset player data" }}
  </button>
</template>

<style scoped>
.reset-player {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 10;
  padding: 6px 10px;
  font-size: 12px;
  font-family: system-ui, sans-serif;
  background: rgba(15, 15, 14, 0.92);
  border: 1px solid #34332c;
  color: #8a8578;
  border-radius: 4px;
  cursor: pointer;
}
.reset-player:hover {
  color: #d8d4c8;
  border-color: #c94f3f;
}
.reset-player:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
