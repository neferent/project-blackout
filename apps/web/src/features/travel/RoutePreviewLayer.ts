import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { LineStringGeometry } from "@blackout/shared";
import { registerMapLayer } from "../../map/layerRegistry.js";

const SOURCE_ID = "route-preview";
const LAYER_ID = "route-preview-line";

// Distinct from the direct-route amber so the "goes around the danger zone"
// alternative reads as a different, safer option rather than a second copy
// of the same route.
const AVOIDING_SOURCE_ID = "route-preview-avoiding";
const AVOIDING_LAYER_ID = "route-preview-avoiding-line";

export function ensureRoutePreviewLayer(map: MapLibreMap): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addSource(AVOIDING_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  // Opacity kept just under 1 on both so they render in MapLibre's
  // translucent pass rather than the opaque one — opaque line layers get
  // depth-tested against 3D buildings and disappear behind them.
  registerMapLayer(map, "markers", {
    id: AVOIDING_LAYER_ID,
    type: "line",
    source: AVOIDING_SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#4bb86a", "line-width": 3, "line-dasharray": [1, 1.5], "line-opacity": 0.99 },
  });
  registerMapLayer(map, "markers", {
    id: LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#e8b84b", "line-width": 3, "line-dasharray": [1, 1.5], "line-opacity": 0.99 },
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

/** The alternative route around a danger zone, or null to clear it. */
export function setAvoidingRoutePreview(map: MapLibreMap, route: LineStringGeometry | null): void {
  const source = map.getSource(AVOIDING_SOURCE_ID);
  if (!source || source.type !== "geojson") return;
  (source as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: route ? [{ type: "Feature", geometry: route, properties: {} }] : [],
  });
}
