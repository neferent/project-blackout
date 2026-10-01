import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { LatLng } from "@blackout/shared";
import { registerMapLayer } from "../../map/layerRegistry.js";

const SOURCE_ID = "home-base-highlight";
const FILL_LAYER_ID = "home-base-highlight-fill";
const LINE_LAYER_ID = "home-base-highlight-line";

// Matches the fallback in the base "building" layer (style.ts) so a
// highlighted building that isn't rendered/tagged there still gets a
// plausible low-rise box instead of a flat sliver.
const DEFAULT_HEIGHT = 6;

// Same green as BaseMarkerLayer's dot, so the building and its marker read
// as one "home" color distinct from the amber travel-destination highlight.
const HOME_BASE_COLOR = "#3f7a4f";

/**
 * Persistent tint over the building containing the player's home base —
 * distinct from BuildingHighlightLayer's transient (single, cleared-on-
 * cancel) destination-picker highlight, so both can be shown at once.
 */
export function ensureHomeBaseHighlightLayer(map: MapLibreMap): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  registerMapLayer(map, "overlay-over-buildings", {
    id: FILL_LAYER_ID,
    type: "fill-extrusion",
    source: SOURCE_ID,
    paint: {
      "fill-extrusion-color": HOME_BASE_COLOR,
      "fill-extrusion-opacity": 0.4,
      "fill-extrusion-height": ["get", "height"],
      "fill-extrusion-base": ["get", "minHeight"],
    },
  });
  registerMapLayer(map, "overlay-over-buildings", {
    id: LINE_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    paint: { "line-color": HOME_BASE_COLOR, "line-width": 2 },
  });
}

/** Same outline shape as BuildingHighlightLayer.setBuildingHighlight — see its doc comment. */
export function setHomeBaseHighlight(map: MapLibreMap, outline: LatLng[][] | null): void {
  const source = map.getSource(SOURCE_ID);
  if (!source || source.type !== "geojson") return;
  (source as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: outline
      ? [
          {
            type: "Feature",
            geometry: {
              type: "MultiPolygon",
              coordinates: outline.map((ring) => [ring.map((p) => [p.lng, p.lat])]),
            },
            properties: buildingHeightProperties(map, outline),
          },
        ]
      : [],
  });
}

function buildingHeightProperties(map: MapLibreMap, outline: LatLng[][]): { height: number; minHeight: number } {
  const points = outline.flat();
  const centroid = {
    lng: points.reduce((sum, p) => sum + p.lng, 0) / points.length,
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
  };
  const screenPoint = map.project([centroid.lng, centroid.lat]);
  const [feature] = map.queryRenderedFeatures(screenPoint, { layers: ["building"] });
  const props = feature?.properties as { render_height?: number; render_min_height?: number } | undefined;
  return {
    height: (props?.render_height ?? DEFAULT_HEIGHT) + 0.4,
    minHeight: Math.max((props?.render_min_height ?? 0) - 0.2, 0),
  };
}
