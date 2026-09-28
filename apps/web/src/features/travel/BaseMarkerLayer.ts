import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { LatLng } from "@blackout/shared";
import { registerMapLayer } from "../../map/layerRegistry.js";

const SOURCE_ID = "base-position";
const LAYER_ID = "base-marker";

/**
 * The player's base/shelter: fixed at their chosen start point. Distinct from
 * the player marker, which moves. Static for the POC — set once and done.
 */
export function ensureBaseMarkerLayer(map: MapLibreMap): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  registerMapLayer(map, "markers", {
    id: LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    paint: {
      "circle-radius": 8,
      "circle-color": "#3f7a4f",
      "circle-stroke-width": 2,
      "circle-stroke-color": "#0b0c0d",
    },
  });
}

export function setBaseMarkerPosition(map: MapLibreMap, position: LatLng): void {
  const source = map.getSource(SOURCE_ID);
  if (!source || source.type !== "geojson") return;
  (source as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [position.lng, position.lat] },
        properties: {},
      },
    ],
  });
}
