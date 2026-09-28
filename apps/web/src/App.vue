<script setup lang="ts">
import { onMounted, ref } from "vue";
import MapView from "./map/MapView.vue";
import StartPicker from "./features/placement/StartPicker.vue";
import TravelPanel from "./features/travel/TravelPanel.vue";
import { usePlayerStore } from "./stores/playerStore.js";

const playerStore = usePlayerStore();
const ready = ref(false);

onMounted(async () => {
  await playerStore.refresh();
  ready.value = true;
});
</script>

<template>
  <MapView />
  <template v-if="ready">
    <StartPicker v-if="!playerStore.state" @placed="() => {}" />
    <TravelPanel v-else />
  </template>
</template>
