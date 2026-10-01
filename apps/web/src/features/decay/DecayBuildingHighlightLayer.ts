import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { BuildingsInZoneResponse } from "@blackout/shared";
import { registerMapLayer } from "../../map/layerRegistry.js";

const SOURCE_ID = "decay-building-highlight";
const LAYER_ID = "decay-building-highlight-fill";

// Same hue as DecayZoneLayer's slab, so a tinted building reads as "part of
// the same zone" rather than a separately-caused effect.
const DECAY_COLOR = "#7a3fa0";
const DEFAULT_HEIGHT = 6;

export function ensureDecayBuildingHighlightLayer(map: MapLibreMap): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  registerMapLayer(map, "overlay-over-buildings", {
    id: LAYER_ID,
    type: "fill-extrusion",
    source: SOURCE_ID,
    paint: {
      "fill-extrusion-color": DECAY_COLOR,
      "fill-extrusion-opacity": 0.5,
      "fill-extrusion-height": ["get", "height"],
      "fill-extrusion-base": 0,
    },
  });
}

/**
 * `buildings` should come from findBuildingsInZone (apps/web/src/geo/
 * buildings.ts), which resolves full-fidelity OSM geometry via the API
 * rather than MapLibre's rendered vector tiles — the latter's geometry is
 * tile-clipped and simplified per zoom level, which produced a different
 * (and often much larger) set of "matches" depending on the current
 * zoom/viewport when tried here directly.
 */
export function setDecayBuildingHighlights(map: MapLibreMap, buildings: BuildingsInZoneResponse): void {
  const source = map.getSource(SOURCE_ID);
  if (!source || source.type !== "geojson") return;

  (source as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: buildings.map((building) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [building.outline.map((p) => [p.lng, p.lat])] },
      properties: { height: (building.height ?? DEFAULT_HEIGHT) + 0.4 },
    })),
  });
}
