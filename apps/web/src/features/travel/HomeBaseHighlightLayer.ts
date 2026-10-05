import { cellToBoundary } from "h3-js";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { registerMapLayer } from "../../map/layerRegistry.js";

const SOURCE_ID = "home-base-highlight";
const FILL_LAYER_ID = "home-base-highlight-fill";
const LINE_LAYER_ID = "home-base-highlight-line";

// Same green as BaseMarkerLayer's dot, so the hex and its marker read
// as one "home" color distinct from the amber travel-destination highlight.
const HOME_BASE_COLOR = "#3f7a4f";

/**
 * Persistent tint over the player's base hex — distinct from
 * BuildingHighlightLayer's transient (single, cleared-on-cancel)
 * destination-picker highlight, so both can be shown at once. Flat fill +
 * line, same visual language as AreaDangerLayer's hex mosaic. Idempotent
 * per-layer, not just per-source: a dev-server HMR reload can re-run this
 * against a map instance (held in Pinia) that already has the source from
 * a previous version of this file, and bailing out on the source alone
 * would silently skip any layer added since.
 */
export function ensureHomeBaseHighlightLayer(map: MapLibreMap): void {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }

  if (!map.getLayer(FILL_LAYER_ID)) {
    registerMapLayer(map, "overlay-over-buildings", {
      id: FILL_LAYER_ID,
      type: "fill",
      source: SOURCE_ID,
      paint: { "fill-color": HOME_BASE_COLOR, "fill-opacity": 0.35 },
    });
  }
  if (!map.getLayer(LINE_LAYER_ID)) {
    registerMapLayer(map, "overlay-over-buildings", {
      id: LINE_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      paint: { "line-color": HOME_BASE_COLOR, "line-width": 2 },
    });
  }
}

/** Same hex-outline shape as BuildingHighlightLayer.setBuildingHighlight — see that file's doc comment. */
export function setHomeBaseHighlight(map: MapLibreMap, cell: string | null): void {
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
