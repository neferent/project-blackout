import { defineStore } from "pinia";
import { shallowRef } from "vue";
import type { Map as MapLibreMap } from "maplibre-gl";

/** Holds the single MapLibre instance so features can register layers/handlers on it. */
export const useMapStore = defineStore("map", () => {
  const map = shallowRef<MapLibreMap | null>(null);

  function setMap(instance: MapLibreMap | null) {
    map.value = instance;
  }

  return { map, setMap };
});
