<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import type { LatLng, RoutePreviewResponse } from "@blackout/shared";
import { interpolateAlongLine, tripProgress } from "@blackout/shared";
import { useMapStore } from "../../stores/mapStore.js";
import { usePlayerStore } from "../../stores/playerStore.js";
import { apiClient } from "../../api/client.js";
import { ensurePlayerMarkerLayer, setPlayerMarkerPosition } from "./PlayerMarkerLayer.js";
import { ensureRoutePreviewLayer, setRoutePreview } from "./RoutePreviewLayer.js";
import { ensureBaseMarkerLayer, setBaseMarkerPosition } from "./BaseMarkerLayer.js";

const mapStore = useMapStore();
const playerStore = usePlayerStore();

const preview = ref<RoutePreviewResponse | null>(null);
const pendingDestination = ref<LatLng | null>(null);
const previewing = ref(false);
const starting = ref(false);
let clickHandler: ((e: MapMouseEvent) => void) | null = null;
let animationFrame: number | null = null;
let pollInterval: ReturnType<typeof setInterval> | undefined;

function isTraveling(): boolean {
  return Boolean(playerStore.state?.activeAction);
}

async function requestPreview(destination: LatLng) {
  if (!playerStore.state || isTraveling()) return;
  previewing.value = true;
  pendingDestination.value = destination;
  try {
    preview.value = await apiClient.post<RoutePreviewResponse>("/routes/preview", {
      origin: playerStore.state.position,
      destination,
    });
    const map = mapStore.map;
    if (map) setRoutePreview(map, preview.value.route);
  } finally {
    previewing.value = false;
  }
}

function cancelPreview() {
  preview.value = null;
  pendingDestination.value = null;
  const map = mapStore.map;
  if (map) setRoutePreview(map, null);
}

async function confirmTravel() {
  if (!pendingDestination.value) return;
  starting.value = true;
  try {
    await apiClient.post("/actions/travel", { destination: pendingDestination.value });
    cancelPreview();
    await playerStore.refresh();
    startAnimationLoop();
  } finally {
    starting.value = false;
  }
}

function startAnimationLoop() {
  stopAnimationLoop();

  function tick() {
    const state = playerStore.state;
    const map = mapStore.map;
    const action = state?.activeAction;
    if (!state || !map || !action) return;

    const data = action.data as { route: { coordinates: [number, number][] } };
    const fraction = tripProgress(action.startsAt, action.endsAt, new Date());
    setPlayerMarkerPosition(map, interpolateAlongLine(data.route.coordinates, fraction));

    if (fraction < 1) {
      animationFrame = requestAnimationFrame(tick);
    } else {
      playerStore.refresh(); // finalizes resting position server-side, clears activeAction
    }
  }

  animationFrame = requestAnimationFrame(tick);

  // Server is the source of truth: periodically resync in case of drift or a stalled tab.
  pollInterval = setInterval(async () => {
    await playerStore.refresh();
    if (!isTraveling()) stopAnimationLoop();
  }, 5000);
}

function stopAnimationLoop() {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  clearInterval(pollInterval);
}

onMounted(() => {
  const map = mapStore.map;
  if (map) setup(map);
  else {
    const stop = watch(
      () => mapStore.map,
      (m) => {
        if (m) {
          setup(m);
          stop();
        }
      },
    );
  }
});

function setup(map: MapLibreMap) {
  ensureBaseMarkerLayer(map);
  ensurePlayerMarkerLayer(map);
  ensureRoutePreviewLayer(map);
  if (playerStore.state) {
    setBaseMarkerPosition(map, playerStore.state.basePosition);
    setPlayerMarkerPosition(map, playerStore.state.position);
  }

  clickHandler = (e) => {
    if (isTraveling() || previewing.value) return;
    requestPreview({ lat: e.lngLat.lat, lng: e.lngLat.lng });
  };
  map.on("click", clickHandler);

  if (isTraveling()) startAnimationLoop();
}

onUnmounted(() => {
  if (clickHandler && mapStore.map) mapStore.map.off("click", clickHandler);
  stopAnimationLoop();
});
</script>

<template>
  <div v-if="preview" class="travel-panel">
    <div class="stat"><span>Distance</span><strong>{{ preview.distanceKm.toFixed(2) }} km</strong></div>
    <div class="stat"><span>Game time</span><strong>{{ (preview.gameSeconds / 3600).toFixed(1) }} h</strong></div>
    <div class="stat"><span>Real time</span><strong>{{ Math.ceil(preview.realSeconds) }} s</strong></div>
    <div class="actions">
      <button class="secondary" @click="cancelPreview">Cancel</button>
      <button :disabled="starting" @click="confirmTravel">{{ starting ? "Starting..." : "Travel" }}</button>
    </div>
  </div>
</template>

<style scoped>
.travel-panel {
  position: fixed;
  right: 16px;
  top: 16px;
  background: rgba(15, 15, 14, 0.92);
  border: 1px solid #2a2a26;
  border-radius: 8px;
  padding: 14px;
  color: #d8d4c8;
  font-family: system-ui, sans-serif;
  min-width: 180px;
}
.stat {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  margin-bottom: 6px;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
button {
  flex: 1;
  background: #c94f3f;
  color: #fff;
  border: none;
  padding: 8px 10px;
  border-radius: 4px;
  cursor: pointer;
}
button.secondary {
  background: #34332c;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
