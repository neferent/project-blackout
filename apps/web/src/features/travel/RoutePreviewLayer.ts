import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { LineStringGeometry } from "@blackout/shared";
import { registerMapLayer } from "../../map/layerRegistry.js";

const SOURCE_ID = "route-preview";
const LAYER_ID = "route-preview-line";

export function ensureRoutePreviewLayer(map: MapLibreMap): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  registerMapLayer(map, "markers", {
    id: LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#e8b84b", "line-width": 3, "line-dasharray": [1, 1.5] },
  });
}

export function setRoutePreview(map: MapLibreMap, route: LineStringGeometry | null): void {
  const source = map.getSource(SOURCE_ID);
  if (!source || source.type !== "geojson") return;
  (source as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: route ? [{ type: "Feature", geometry: route, properties: {} }] : [],
  });
}
