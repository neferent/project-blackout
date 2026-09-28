import type { LayerSpecification, Map as MapLibreMap } from "maplibre-gl";

/**
 * Fixed z-order slots every feature's map layers register into. The POC only
 * fills basemap, labels, and player; scavenging/buildings/danger/encounters
 * plug into the others later without renegotiating layer order.
 */
export const MAP_LAYER_SLOTS = [
  "basemap",
  "overlay-under-buildings",
  "buildings",
  "overlay-over-buildings",
  "markers",
  "labels",
  "player",
] as const;
export type MapLayerSlot = (typeof MAP_LAYER_SLOTS)[number];

/** Adds a layer, inserting it just before the first existing layer in a later slot. */
export function registerMapLayer(map: MapLibreMap, slot: MapLayerSlot, layer: LayerSpecification): void {
  const slotIndex = MAP_LAYER_SLOTS.indexOf(slot);
  const existing = map.getStyle().layers ?? [];

  const before = existing.find((l) => {
    const layerSlot = (l.metadata as { slot?: MapLayerSlot } | undefined)?.slot;
    return layerSlot !== undefined && MAP_LAYER_SLOTS.indexOf(layerSlot) > slotIndex;
  });

  map.addLayer(
    { ...layer, metadata: { ...(layer.metadata as object | undefined), slot } } as LayerSpecification,
    before?.id,
  );
}
