<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import maplibregl from "maplibre-gl";
import { useMapStore } from "../../stores/mapStore.js";
import { usePlayerStore } from "../../stores/playerStore.js";
import { config } from "../../config.js";
import { searchPlaces, type NominatimResult } from "./nominatim.js";

const emit = defineEmits<{ placed: [] }>();

const mapStore = useMapStore();
const playerStore = usePlayerStore();

const query = ref("");
const results = ref<NominatimResult[]>([]);
const pending = ref<{ lat: number; lng: number } | null>(null);
const searching = ref(false);
const creating = ref(false);
let marker: maplibregl.Marker | null = null;
let searchDebounce: ReturnType<typeof setTimeout> | undefined;
let clickHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;

function setPending(position: { lat: number; lng: number }) {
  pending.value = position;
  const map = mapStore.map;
  if (!map) return;
  if (!marker) {
    marker = new maplibregl.Marker({ color: "#c94f3f" }).setLngLat([position.lng, position.lat]).addTo(map);
  } else {
    marker.setLngLat([position.lng, position.lat]);
  }
}

function attachClickHandler() {
  const map = mapStore.map;
  if (!map) return;
  clickHandler = (e) => setPending({ lat: e.lngLat.lat, lng: e.lngLat.lng });
  map.on("click", clickHandler);
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
  marker?.remove();
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
  if (!pending.value) return;
  creating.value = true;
  try {
    await playerStore.create(pending.value);
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

    <div class="footer">
      <span v-if="pending" class="pending">{{ pending.lat.toFixed(4) }}, {{ pending.lng.toFixed(4) }}</span>
      <button :disabled="!pending || creating" @click="confirm">
        {{ creating ? "Placing..." : "Confirm start point" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.start-picker {
  position: fixed;
  left: 50%;
  bottom: 32px;
  transform: translateX(-50%);
  width: min(420px, 90vw);
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
.footer {
  margin-top: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.pending {
  font-size: 12px;
  color: #8a8578;
}
button {
  background: #c94f3f;
  color: #fff;
  border: none;
  padding: 8px 14px;
  border-radius: 4px;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
