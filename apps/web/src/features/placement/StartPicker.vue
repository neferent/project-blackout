<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import * as maplibregl from "maplibre-gl";
import { interactionCellCenter, interactionCellForPosition } from "@blackout/shared";
import { useMapStore } from "../../stores/mapStore.js";
import { usePlayerStore } from "../../stores/playerStore.js";
import { config } from "../../config.js";
import { reverseGeocode, searchPlaces, type NominatimResult } from "../../geo/nominatim.js";
import { ensureHomeBaseHighlightLayer, setHomeBaseHighlight } from "../travel/HomeBaseHighlightLayer.js";
import { classifyHexGrid, hexGridWarning, type HexGridResult } from "./hexGrid.js";
import HexPreviewPopover from "./HexPreviewPopover.vue";

const emit = defineEmits<{ placed: [] }>();

const mapStore = useMapStore();
const playerStore = usePlayerStore();

const query = ref("");
const results = ref<NominatimResult[]>([]);
const pending = ref<{ lat: number; lng: number } | null>(null);
const pendingCell = ref<string | null>(null);
const searching = ref(false);
const creating = ref(false);
let marker: maplibregl.Marker | null = null;
let searchDebounce: ReturnType<typeof setTimeout> | undefined;
let clickHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;

// One combined popover (grid + stats + confirm, see HexPreviewPopover) shown next to
// whatever hex is clicked — no separate "browsing" vs. "chosen" screen.
const grid = ref<HexGridResult | null>(null);

// Screen position of the previewed hex, kept in sync with map pans/zooms so the popover
// tracks the tile instead of drifting from it (see attachClickHandler/reposition below).
const popoverAnchor = ref<{ x: number; y: number } | null>(null);
const cityName = ref<string | null>(null);
const cityLoading = ref(false);
let cityRequestId = 0;
let moveHandler: (() => void) | null = null;

function repositionPopover() {
  const map = mapStore.map;
  if (!map || !pending.value) return;
  const point = map.project([pending.value.lng, pending.value.lat]);
  popoverAnchor.value = { x: point.x, y: point.y };
}

function refreshGrid() {
  const map = mapStore.map;
  if (!map || !pendingCell.value) return;
  grid.value = classifyHexGrid(map, pendingCell.value);
}

async function refreshCityName(position: { lat: number; lng: number }) {
  const requestId = ++cityRequestId;
  cityLoading.value = true;
  try {
    const result = await reverseGeocode(position).catch(() => null);
    if (requestId !== cityRequestId) return; // a later click superseded this one
    cityName.value = result?.city ?? null;
  } finally {
    if (requestId === cityRequestId) cityLoading.value = false;
  }
}

/** Snaps the click to the resolution-11 hex it falls in and shows the marker at that
 * hex's center — the actual base position that'll be created (see Part B/C: the server
 * snaps to this same hex's center). */
function setPending(position: { lat: number; lng: number }) {
  const cell = interactionCellForPosition(position);
  const center = interactionCellCenter(cell);
  pending.value = center;
  pendingCell.value = cell;
  const map = mapStore.map;
  if (!map) return;
  if (!marker) {
    marker = new maplibregl.Marker({ color: "#c94f3f" }).setLngLat([center.lng, center.lat]).addTo(map);
  } else {
    marker.setLngLat([center.lng, center.lat]);
  }
  ensureHomeBaseHighlightLayer(map);
  setHomeBaseHighlight(map, cell);
  refreshGrid();
  repositionPopover();
  refreshCityName(center);
}

function attachClickHandler() {
  const map = mapStore.map;
  if (!map) return;
  clickHandler = (e) => setPending({ lat: e.lngLat.lat, lng: e.lngLat.lng });
  map.on("click", clickHandler);
  moveHandler = () => repositionPopover();
  map.on("move", moveHandler);
}

watch(
  () => mapStore.map,
  (map) => {
    if (map) attachClickHandler();
  },
);

onMounted(() => {
  if (mapStore.map) attachClickHandler();

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (geo) => {
        const position = { lat: geo.coords.latitude, lng: geo.coords.longitude };
        mapStore.map?.flyTo({ center: [position.lng, position.lat], zoom: 15 });
        setPending(position);
      },
      () => {
        // Denied or unavailable: fall back to the configured default center, already the map's initial view.
        setPending(config.defaultCenter);
      },
      { timeout: 5000 },
    );
  } else {
    setPending(config.defaultCenter);
  }
});

onUnmounted(() => {
  if (clickHandler && mapStore.map) mapStore.map.off("click", clickHandler);
  if (moveHandler && mapStore.map) mapStore.map.off("move", moveHandler);
  marker?.remove();
  if (mapStore.map) setHomeBaseHighlight(mapStore.map, null);
});

watch(query, (value) => {
  clearTimeout(searchDebounce);
  if (!value.trim()) {
    results.value = [];
    return;
  }
  searchDebounce = setTimeout(async () => {
    searching.value = true;
    try {
      results.value = await searchPlaces(value);
    } finally {
      searching.value = false;
    }
  }, 400);
});

function selectResult(result: NominatimResult) {
  const position = { lat: Number(result.lat), lng: Number(result.lon) };
  mapStore.map?.flyTo({ center: [position.lng, position.lat], zoom: 15 });
  setPending(position);
  results.value = [];
  query.value = result.display_name;
}

async function confirm() {
  if (!pending.value || !grid.value) return;
  const warning = hexGridWarning(grid.value);
  if (warning === "no-buildings" || warning === "too-few-buildings") return;
  creating.value = true;
  try {
    await playerStore.create(pending.value, grid.value);
    emit("placed");
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div class="start-picker">
    <h1>Choose your start point</h1>
    <p>Search for a place, or click anywhere on the map.</p>

    <input v-model="query" type="text" placeholder="Search for a place..." />
    <ul v-if="results.length" class="results">
      <li v-for="result in results" :key="result.display_name" @click="selectResult(result)">
        {{ result.display_name }}
      </li>
    </ul>

    <span v-if="pending" class="pending">{{ pending.lat.toFixed(4) }}, {{ pending.lng.toFixed(4) }}</span>
  </div>

  <HexPreviewPopover
    v-if="popoverAnchor"
    :grid="grid"
    :city="cityName"
    :city-loading="cityLoading"
    :creating="creating"
    :anchor="popoverAnchor"
    @confirm="confirm"
  />
</template>

<style scoped>
.start-picker {
  position: fixed;
  left: 50%;
  bottom: 32px;
  transform: translateX(-50%);
  width: min(480px, 90vw);
  background: rgba(15, 15, 14, 0.92);
  border: 1px solid #2a2a26;
  border-radius: 8px;
  padding: 16px;
  color: #d8d4c8;
  font-family: system-ui, sans-serif;
}
h1 {
  font-size: 16px;
  margin: 0 0 4px;
}
p {
  font-size: 13px;
  color: #8a8578;
  margin: 0 0 12px;
}
input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  background: #1a1a17;
  border: 1px solid #34332c;
  color: #d8d4c8;
  border-radius: 4px;
}
.results {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  max-height: 160px;
  overflow-y: auto;
  border: 1px solid #34332c;
  border-radius: 4px;
}
.results li {
  padding: 8px 10px;
  cursor: pointer;
  font-size: 13px;
}
.results li:hover {
  background: #26261f;
}
.pending {
  display: block;
  margin-top: 12px;
  font-size: 12px;
  color: #8a8578;
}
</style>
