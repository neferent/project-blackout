<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import type { LatLng, LineStringGeometry, RoutePreviewResponse, TravelHistoryResponse } from "@blackout/shared";
import { interpolateAlongLine, travelHistoryResponseSchema, tripProgress } from "@blackout/shared";
import { useMapStore } from "../../stores/mapStore.js";
import { usePlayerStore } from "../../stores/playerStore.js";
import { apiClient } from "../../api/client.js";
import { ensurePlayerMarkerLayer, setPlayerMarkerPosition } from "./PlayerMarkerLayer.js";
import { ensureRoutePreviewLayer, setAvoidingRoutePreview, setRoutePreview } from "./RoutePreviewLayer.js";
import { ensureBaseMarkerLayer, setBaseMarkerPosition } from "./BaseMarkerLayer.js";
import { ensureBuildingHighlightLayer, setBuildingHighlight } from "./BuildingHighlightLayer.js";
import { ensureHomeBaseHighlightLayer, setHomeBaseHighlight } from "./HomeBaseHighlightLayer.js";
import { ensureActiveRouteLayer, setActiveRoute } from "./ActiveRouteLayer.js";
import { ensureRouteHistoryLayer, setRouteHistory } from "./RouteHistoryLayer.js";
import { ensureDecayZoneLayer, setDecayZones } from "../decay/DecayZoneLayer.js";
import {
  ensureDecayBuildingHighlightLayer,
  setDecayBuildingHighlights,
} from "../decay/DecayBuildingHighlightLayer.js";
import { describePlace, reverseGeocode } from "../../geo/nominatim.js";
import { describeBuilding, findBuildingAt } from "../../geo/buildings.js";
import { fetchZoneBuildings, fetchZonesInViewport } from "../../geo/zones.js";

const mapStore = useMapStore();
const playerStore = usePlayerStore();

const preview = ref<RoutePreviewResponse | null>(null);
const pendingDestination = ref<LatLng | null>(null);
const previewing = ref(false);
const starting = ref(false);
const destinationPlace = ref<string | null>(null);
const destinationContains = ref<{ name: string; kind: string }[]>([]);
const placeLoading = ref(false);
const remaining = ref<{ distanceKm: number; realSeconds: number; gameSeconds: number } | null>(null);
const routeHistory = ref<TravelHistoryResponse>([]);
let clickHandler: ((e: MapMouseEvent) => void) | null = null;
let moveEndHandler: (() => void) | null = null;
// Guards against a slow viewport fetch resolving after a newer one (same
// pattern as destinationRequestId below) — pan/zoom fires "moveend" far more
// often than any single fetch resolves.
let zoneRequestId = 0;
let animationFrame: number | null = null;
let pollInterval: ReturnType<typeof setInterval> | undefined;
// Guards against a slow lookup for an earlier click overwriting a faster
// (e.g. cache-hit) response for a later click — responses can resolve out
// of click order since neither request is cancelled client-side.
let destinationRequestId = 0;

function isTraveling(): boolean {
  return Boolean(playerStore.state?.activeAction);
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m > 0 ? `${m}m ${rem}s` : `${rem}s`;
}

/**
 * What's at the clicked point. Finds the building polygon there (point-in-
 * polygon containment, not nearest-point) and highlights it, listing every
 * other shop/amenity feature whose point falls inside that same polygon —
 * so a store's separately-mapped sub-departments (pharmacy, garden center,
 * ...) show up as *contents* of the store, not as the answer itself.
 * Nominatim's reverse endpoint is kept only as a fallback for points with no
 * nearby building (open land, streets, ...).
 */
async function describeDestination(destination: LatLng, requestId: number): Promise<void> {
  const map = mapStore.map;
  const building = await findBuildingAt(destination).catch(() => null);
  if (requestId !== destinationRequestId) return; // a later click superseded this one

  if (building) {
    destinationPlace.value = describeBuilding(building);
    destinationContains.value = building.contains;
    if (map) setBuildingHighlight(map, building.outline);
    return;
  }

  if (map) setBuildingHighlight(map, null);
  const nominatimPlace = await reverseGeocode(destination).catch(() => null);
  if (requestId !== destinationRequestId) return;

  destinationPlace.value = nominatimPlace ? describePlace(nominatimPlace) : "Unknown";
  destinationContains.value = [];
}

/** Looks up and highlights what's at a point without touching travel state — safe to
 * call while already traveling, when starting a new trip isn't possible but inspecting
 * what's out there still should be. */
function inspectDestination(destination: LatLng) {
  destinationPlace.value = null;
  destinationContains.value = [];
  placeLoading.value = true;

  const requestId = ++destinationRequestId;
  describeDestination(destination, requestId).finally(() => {
    if (requestId === destinationRequestId) placeLoading.value = false;
  });
}

function dismissInspect() {
  destinationRequestId++;
  destinationPlace.value = null;
  destinationContains.value = [];
  placeLoading.value = false;
  const map = mapStore.map;
  if (map) setBuildingHighlight(map, null);
}

async function requestPreview(destination: LatLng) {
  if (!playerStore.state || isTraveling()) return;
  previewing.value = true;
  pendingDestination.value = destination;
  destinationPlace.value = null;
  destinationContains.value = [];
  placeLoading.value = true;

  // Fetched in parallel: what's-at-this-point doesn't need to block the route preview.
  const requestId = ++destinationRequestId;
  describeDestination(destination, requestId).finally(() => {
    if (requestId === destinationRequestId) placeLoading.value = false;
  });

  try {
    preview.value = await apiClient.post<RoutePreviewResponse>("/routes/preview", {
      origin: playerStore.state.position,
      destination,
    });
    const map = mapStore.map;
    if (map) {
      setRoutePreview(map, preview.value.route);
      setAvoidingRoutePreview(map, preview.value.avoidingDanger?.route ?? null);
    }
  } finally {
    previewing.value = false;
  }
}

function cancelPreview() {
  destinationRequestId++; // invalidate any in-flight lookup
  preview.value = null;
  pendingDestination.value = null;
  destinationPlace.value = null;
  destinationContains.value = [];
  placeLoading.value = false;
  const map = mapStore.map;
  if (map) {
    setRoutePreview(map, null);
    setAvoidingRoutePreview(map, null);
    setBuildingHighlight(map, null);
  }
}

async function beginTravel(destination: LatLng, routeChoice: "direct" | "avoiding" = "avoiding") {
  starting.value = true;
  try {
    await apiClient.post("/actions/travel", { destination, routeChoice });
    cancelPreview();
    await playerStore.refresh();
    startAnimationLoop();
  } finally {
    starting.value = false;
  }
}

async function confirmTravel(routeChoice: "direct" | "avoiding" = "avoiding") {
  if (!pendingDestination.value) return;
  await beginTravel(pendingDestination.value, routeChoice);
}

async function returnHome() {
  if (!playerStore.state || isTraveling()) return;
  await beginTravel(playerStore.state.basePosition);
}

/**
 * Pulls only the zones intersecting the map's current viewport (shapes, not
 * building lists — see fetchZonesInViewport) and renders them, then pulls
 * each visible zone's persisted building list in parallel and merges them
 * into one combined highlight. Re-run on every "moveend" since which zones
 * are in view changes as the map pans/zooms.
 */
async function refreshDangerZones(map: MapLibreMap) {
  const requestId = ++zoneRequestId;
  const bounds = map.getBounds();
  const zones = await fetchZonesInViewport({
    minLat: bounds.getSouth(),
    minLng: bounds.getWest(),
    maxLat: bounds.getNorth(),
    maxLng: bounds.getEast(),
  }).catch(() => []);
  if (requestId !== zoneRequestId) return; // a later "moveend" superseded this one

  setDecayZones(map, zones.map((zone) => zone.polygon));

  const buildingLists = await Promise.all(zones.map((zone) => fetchZoneBuildings(zone.id).catch(() => [])));
  if (requestId !== zoneRequestId) return;
  setDecayBuildingHighlights(map, buildingLists.flat());
}

async function refreshRouteHistory() {
  const response = await apiClient.get("/actions/history").catch(() => null);
  if (!response) return;
  routeHistory.value = travelHistoryResponseSchema.parse(response);
  const map = mapStore.map;
  if (map) setRouteHistory(map, routeHistory.value.map((item) => item.route));
}

function isAtHome(): boolean {
  const state = playerStore.state;
  if (!state) return false;
  return (
    Math.abs(state.position.lat - state.basePosition.lat) < 1e-5 &&
    Math.abs(state.position.lng - state.basePosition.lng) < 1e-5
  );
}

function startAnimationLoop() {
  stopAnimationLoop();

  function tick() {
    const state = playerStore.state;
    const map = mapStore.map;
    const action = state?.activeAction;
    if (!state || !map || !action) {
      remaining.value = null;
      return;
    }

    const data = action.data as { route: LineStringGeometry; distanceKm: number };
    const now = new Date();
    const fraction = tripProgress(action.startsAt, action.endsAt, now);
    setPlayerMarkerPosition(map, interpolateAlongLine(data.route.coordinates, fraction));
    setActiveRoute(map, data.route, fraction);

    const realSecondsLeft = Math.max(0, (action.endsAt.getTime() - now.getTime()) / 1000);
    remaining.value = {
      distanceKm: data.distanceKm * (1 - fraction),
      realSeconds: realSecondsLeft,
      gameSeconds: realSecondsLeft * 60, // matches GAME_SECONDS_PER_REAL_SECOND
    };

    if (fraction < 1) {
      animationFrame = requestAnimationFrame(tick);
    } else {
      remaining.value = null;
      setActiveRoute(map, null, 0);
      playerStore.refresh().then(refreshRouteHistory); // finalizes resting position server-side, clears activeAction
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
  if (!isTraveling()) remaining.value = null;
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
  // Registration order sets stacking within the "markers" slot: faded history
  // at the bottom, then the active route, then the click preview, then markers.
  ensureRouteHistoryLayer(map);
  ensureActiveRouteLayer(map);
  ensureRoutePreviewLayer(map);
  ensureBaseMarkerLayer(map);
  ensurePlayerMarkerLayer(map);
  ensureBuildingHighlightLayer(map);
  ensureHomeBaseHighlightLayer(map);
  ensureDecayZoneLayer(map);
  ensureDecayBuildingHighlightLayer(map);
  refreshDangerZones(map);
  moveEndHandler = () => refreshDangerZones(map);
  map.on("moveend", moveEndHandler);
  refreshRouteHistory();
  if (playerStore.state) {
    setBaseMarkerPosition(map, playerStore.state.basePosition);
    setPlayerMarkerPosition(map, playerStore.state.position);
    // Recenter on the player's actual game position — the map otherwise sits
    // at the config default center until something else moves it.
    map.jumpTo({ center: [playerStore.state.position.lng, playerStore.state.position.lat], zoom: 15 });
    // Base position is fixed for the POC (see BaseMarkerLayer) — resolve its
    // building once rather than re-querying on every render.
    findBuildingAt(playerStore.state.basePosition)
      .then((building) => setHomeBaseHighlight(map, building?.outline ?? null))
      .catch(() => setHomeBaseHighlight(map, null));
  }

  clickHandler = (e) => {
    if (previewing.value) return;
    const destination = { lat: e.lngLat.lat, lng: e.lngLat.lng };
    if (isTraveling()) {
      inspectDestination(destination); // can't start a new trip, but can still look
    } else {
      requestPreview(destination);
    }
  };
  map.on("click", clickHandler);

  if (isTraveling()) startAnimationLoop();
}

onUnmounted(() => {
  if (clickHandler && mapStore.map) mapStore.map.off("click", clickHandler);
  if (moveEndHandler && mapStore.map) mapStore.map.off("moveend", moveEndHandler);
  stopAnimationLoop();
});
</script>

<template>
  <div class="hud">
    <div v-if="remaining" class="stat">
      <span>Distance left</span><strong>{{ remaining.distanceKm.toFixed(2) }} km</strong>
    </div>
    <div v-if="remaining" class="stat">
      <span>Time left</span><strong>{{ formatDuration(remaining.realSeconds) }}</strong>
    </div>
    <button v-if="!remaining" :disabled="starting || previewing || isAtHome()" @click="returnHome">
      {{ starting ? "Starting..." : isAtHome() ? "At home" : "Return home" }}
    </button>
    <div v-if="playerStore.state" class="coords">
      {{ playerStore.state.position.lat.toFixed(5) }}, {{ playerStore.state.position.lng.toFixed(5) }}
    </div>
  </div>

  <div v-if="preview" class="travel-panel">
    <div class="destination-type">
      {{ placeLoading ? "Looking up destination…" : destinationPlace ?? "Unknown" }}
    </div>
    <ul v-if="destinationContains.length" class="contains-list">
      <li v-for="item in destinationContains" :key="item.name">{{ item.name }} ({{ item.kind }})</li>
    </ul>
    <div class="stat"><span>Distance</span><strong>{{ preview.distanceKm.toFixed(2) }} km</strong></div>
    <div class="stat"><span>Game time</span><strong>{{ (preview.gameSeconds / 3600).toFixed(1) }} h</strong></div>
    <div class="stat"><span>Real time</span><strong>{{ Math.ceil(preview.realSeconds) }} s</strong></div>
    <div v-if="preview.avoidingDanger" class="danger-note">
      Route passes through a danger zone (amber) — a longer path around it (green) is
      {{ preview.avoidingDanger.distanceKm.toFixed(2) }} km.
    </div>
    <div v-if="pendingDestination" class="coords">
      {{ pendingDestination.lat.toFixed(5) }}, {{ pendingDestination.lng.toFixed(5) }}
    </div>
    <div class="actions">
      <button class="secondary" @click="cancelPreview">Cancel</button>
      <template v-if="preview.avoidingDanger">
        <button :disabled="starting" @click="confirmTravel('direct')">
          {{ starting ? "Starting..." : "Through danger" }}
        </button>
        <button class="safe" :disabled="starting" @click="confirmTravel('avoiding')">
          {{ starting ? "Starting..." : "Safe route" }}
        </button>
      </template>
      <button v-else :disabled="starting" @click="confirmTravel('avoiding')">
        {{ starting ? "Starting..." : "Travel" }}
      </button>
    </div>
  </div>

  <!-- Inspecting a building while already traveling: no route/Travel controls, just what's there. -->
  <div v-else-if="isTraveling() && (placeLoading || destinationPlace)" class="travel-panel">
    <div class="destination-type">
      {{ placeLoading ? "Looking up destination…" : destinationPlace ?? "Unknown" }}
    </div>
    <ul v-if="destinationContains.length" class="contains-list">
      <li v-for="item in destinationContains" :key="item.name">{{ item.name }} ({{ item.kind }})</li>
    </ul>
    <div class="actions">
      <button class="secondary" @click="dismissInspect">Close</button>
    </div>
  </div>
</template>

<style scoped>
.hud {
  position: fixed;
  left: 16px;
  top: 16px;
  background: rgba(15, 15, 14, 0.92);
  border: 1px solid #2a2a26;
  border-radius: 8px;
  padding: 14px;
  color: #d8d4c8;
  font-family: system-ui, sans-serif;
  min-width: 160px;
}
.hud button {
  width: 100%;
}
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
.destination-type {
  font-size: 14px;
  font-weight: 600;
  color: #e8b84b;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid #2a2a26;
}
.stat {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  margin-bottom: 6px;
}
.contains-list {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
  font-size: 12px;
  color: #a8a498;
  border-bottom: 1px solid #2a2a26;
  padding-bottom: 8px;
}
.contains-list li {
  padding: 2px 0;
}
.danger-note {
  margin-top: 6px;
  padding: 6px 8px;
  font-size: 12px;
  color: #a8e0b8;
  background: rgba(75, 184, 106, 0.12);
  border: 1px solid rgba(75, 184, 106, 0.35);
  border-radius: 4px;
}
.coords {
  margin-top: 8px;
  font-size: 11px;
  color: #6a6a60;
  font-family: ui-monospace, monospace;
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
button.safe {
  background: #3a8a52;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
