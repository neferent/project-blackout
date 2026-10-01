import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { LatLng } from "@blackout/shared";
import { registerMapLayer } from "../../map/layerRegistry.js";

const SOURCE_ID = "building-highlight";
const FILL_LAYER_ID = "building-highlight-fill";
const LINE_LAYER_ID = "building-highlight-line";

// Matches the fallback in the base "building" layer (style.ts) so a
// highlighted building that isn't rendered/tagged there still gets a
// plausible low-rise box instead of a flat sliver.
const DEFAULT_HEIGHT = 6;

export function ensureBuildingHighlightLayer(map: MapLibreMap): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  // Extrudes to the same height/base as the real building underneath it (set
  // per-feature in setBuildingHighlight) so the highlight reads as a glow
  // over the building's own 3D volume rather than a flat ground decal.
  registerMapLayer(map, "overlay-over-buildings", {
    id: FILL_LAYER_ID,
    type: "fill-extrusion",
    source: SOURCE_ID,
    paint: {
      "fill-extrusion-color": "#e8b84b",
      "fill-extrusion-opacity": 0.35,
      "fill-extrusion-height": ["get", "height"],
      "fill-extrusion-base": ["get", "minHeight"],
    },
  });
  // Ground-level outline of the footprint, for legibility at low pitch/zoom.
  registerMapLayer(map, "overlay-over-buildings", {
    id: LINE_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    paint: { "line-color": "#e8b84b", "line-width": 2 },
  });
}

/**
 * `outline` is one ring per element: a plain way building has one, a
 * multipolygon relation (complex roofs, detached blocks unified as one
 * store) may have several — rendered as separate polygons in a MultiPolygon
 * rather than as outer/hole pairs of a single Polygon.
 */
export function setBuildingHighlight(map: MapLibreMap, outline: LatLng[][] | null): void {
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

/**
 * Reads render_height/render_min_height off the actual rendered "building"
 * layer feature under the outline's centroid, so the highlight extrudes to
 * the same height as the building it's marking. Falls back to the basemap's
 * own default when the tile isn't loaded or the footprint isn't rendered as
 * a building there (e.g. still loading, or Overpass's footprint diverges
 * slightly from the vector tile's).
 */
function buildingHeightProperties(map: MapLibreMap, outline: LatLng[][]): { height: number; minHeight: number } {
  const points = outline.flat();
  const centroid = {
    lng: points.reduce((sum, p) => sum + p.lng, 0) / points.length,
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
  };
  const screenPoint = map.project([centroid.lng, centroid.lat]);
  const [feature] = map.queryRenderedFeatures(screenPoint, { layers: ["building"] });
  const props = feature?.properties as { render_height?: number; render_min_height?: number } | undefined;
  // Slightly proud of the real building's surfaces so the two extrusions
  // don't z-fight at identical heights.
  return {
    height: (props?.render_height ?? DEFAULT_HEIGHT) + 0.4,
    minHeight: Math.max((props?.render_min_height ?? 0) - 0.2, 0),
  };
}
