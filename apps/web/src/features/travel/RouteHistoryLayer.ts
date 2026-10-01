import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { LineStringGeometry } from "@blackout/shared";
import { registerMapLayer } from "../../map/layerRegistry.js";

const SOURCE_ID = "route-history";
const LAYER_ID = "route-history-line";

/** The last few completed trips' routes, drawn as very faded lines. */
export function ensureRouteHistoryLayer(map: MapLibreMap): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  registerMapLayer(map, "markers", {
    id: LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    // A muted violet — distinct from the basemap's gray roads, the amber
    // preview/player color, and the active route's blue, so faded old paths
    // don't blend in and are still identifiable as a different thing.
    paint: { "line-color": "#b87fd8", "line-width": 2, "line-opacity": 0.35 },
  });
}

export function setRouteHistory(map: MapLibreMap, routes: LineStringGeometry[]): void {
  const source = map.getSource(SOURCE_ID);
  if (!source || source.type !== "geojson") return;
  (source as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: routes.map((route) => ({ type: "Feature", geometry: route, properties: {} })),
  });
}
