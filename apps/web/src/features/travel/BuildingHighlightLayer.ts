import { cellToBoundary } from "h3-js";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { registerMapLayer } from "../../map/layerRegistry.js";

const SOURCE_ID = "building-highlight";
const FILL_LAYER_ID = "building-highlight-fill";
const LINE_LAYER_ID = "building-highlight-line";

/** Transient highlight for the INTERACTION_H3_RESOLUTION hex under the travel destination picker. */
export function ensureBuildingHighlightLayer(map: MapLibreMap): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  registerMapLayer(map, "overlay-over-buildings", {
    id: FILL_LAYER_ID,
    type: "fill",
    source: SOURCE_ID,
    paint: { "fill-color": "#e8b84b", "fill-opacity": 0.3 },
  });
  registerMapLayer(map, "overlay-over-buildings", {
    id: LINE_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    paint: { "line-color": "#e8b84b", "line-width": 2 },
  });
}

/** `cell` is the INTERACTION_H3_RESOLUTION hex the picked destination falls in. */
export function setBuildingHighlight(map: MapLibreMap, cell: string | null): void {
  const source = map.getSource(SOURCE_ID);
  if (!source || source.type !== "geojson") return;
  (source as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: cell
      ? [
          {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [cellToBoundary(cell, true)] },
            properties: {},
          },
        ]
      : [],
  });
}
