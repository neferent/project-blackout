<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef } from "vue";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildMapStyle } from "./style.js";
import { config } from "../config.js";
import { useMapStore } from "../stores/mapStore.js";

const mapStore = useMapStore();
const containerRef = useTemplateRef<HTMLDivElement>("container");

onMounted(() => {
  const el = containerRef.value;
  if (!el) return;

  const map = new maplibregl.Map({
    container: el,
    style: buildMapStyle(config.tileSourceUrl, config.glyphsUrl),
    center: [config.defaultCenter.lng, config.defaultCenter.lat],
    zoom: 14,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  mapStore.setMap(map);
});

onUnmounted(() => {
  mapStore.map?.remove();
  mapStore.setMap(null);
});
</script>

<template>
  <div ref="container" class="map-container"></div>
</template>

<style scoped>
.map-container {
  position: fixed;
  inset: 0;
  background: #0b0c0d;
}
</style>
