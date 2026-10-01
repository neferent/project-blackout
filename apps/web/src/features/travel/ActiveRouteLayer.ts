import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { splitLineAtFraction, type LineStringGeometry } from "@blackout/shared";
import { registerMapLayer } from "../../map/layerRegistry.js";

const TRAVELED_SOURCE_ID = "active-route-traveled";
const REMAINING_SOURCE_ID = "active-route-remaining";
const TRAVELED_LAYER_ID = "active-route-traveled-line";
const REMAINING_LAYER_ID = "active-route-remaining-line";

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection" as const, features: [] };

/** The current trip's route, split at progress into a solid "been" half and a dashed "going" half. */
export function ensureActiveRouteLayer(map: MapLibreMap): void {
  if (map.getSource(TRAVELED_SOURCE_ID)) return;

  map.addSource(TRAVELED_SOURCE_ID, { type: "geojson", data: EMPTY_FEATURE_COLLECTION });
  map.addSource(REMAINING_SOURCE_ID, { type: "geojson", data: EMPTY_FEATURE_COLLECTION });

  // Registered remaining-then-traveled so the solid "been" segment draws over
  // the dashed "going" segment at the split point, instead of a visible seam.
  registerMapLayer(map, "markers", {
    id: REMAINING_LAYER_ID,
    type: "line",
    source: REMAINING_SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#7fb8d8", "line-width": 3, "line-dasharray": [1, 1.5], "line-opacity": 0.7 },
  });
  registerMapLayer(map, "markers", {
    id: TRAVELED_LAYER_ID,
    type: "line",
    source: TRAVELED_SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    // Opacity kept just under 1 so this stays in MapLibre's translucent
    // render pass — a fully opaque line layer gets depth-tested against 3D
    // buildings and disappears behind them.
    paint: { "line-color": "#7fb8d8", "line-width": 3, "line-opacity": 0.99 },
  });
}

export function setActiveRoute(map: MapLibreMap, route: LineStringGeometry | null, fraction: number): void {
  const traveledSource = map.getSource(TRAVELED_SOURCE_ID);
  const remainingSource = map.getSource(REMAINING_SOURCE_ID);
  if (!traveledSource || traveledSource.type !== "geojson" || !remainingSource || remainingSource.type !== "geojson") return;

  if (!route) {
    (traveledSource as GeoJSONSource).setData(EMPTY_FEATURE_COLLECTION);
    (remainingSource as GeoJSONSource).setData(EMPTY_FEATURE_COLLECTION);
    return;
  }

  const { traveled, remaining } = splitLineAtFraction(route.coordinates, fraction);
  (traveledSource as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "LineString", coordinates: traveled }, properties: {} }],
  });
  (remainingSource as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "LineString", coordinates: remaining }, properties: {} }],
  });
}
