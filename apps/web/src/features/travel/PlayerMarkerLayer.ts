import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { LatLng } from "@blackout/shared";
import { registerMapLayer } from "../../map/layerRegistry.js";

const SOURCE_ID = "player-position";
const LAYER_ID = "player-marker";

export function ensurePlayerMarkerLayer(map: MapLibreMap): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  registerMapLayer(map, "player", {
    id: LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    paint: {
      "circle-radius": 7,
      "circle-color": "#e8b84b",
      "circle-stroke-width": 2,
      "circle-stroke-color": "#0b0c0d",
    },
  });
}

export function setPlayerMarkerPosition(map: MapLibreMap, position: LatLng): void {
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
