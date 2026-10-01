import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { LatLng } from "@blackout/shared";
import { registerMapLayer } from "../../map/layerRegistry.js";

const SOURCE_ID = "decay-zones";
const FILL_LAYER_ID = "decay-zones-fill";
const LINE_LAYER_ID = "decay-zones-line";

// Sickly purple/toxic, distinct from the amber (destination) and green (home
// base) highlights already on the map.
const DECAY_COLOR = "#7a3fa0";

// How tall the zone's extruded slab rises — enough to read as a raised,
// corrupted plate of ground rather than a flat decal, without competing with
// actual building heights.
const ZONE_EXTRUSION_HEIGHT = 14;

/**
 * Extruded tint for decayed/blighted/phased-out map areas — a raised slab
 * over the zone's footprint, real 3D geometry rather than a flat ground
 * decal, so it reads at a glance from any pitch/angle. fill-extrusion is
 * depth-tested against actual buildings, so slot placement doesn't affect
 * whether buildings occlude it correctly. Placeholder rendering to test the
 * polygon pipeline — no game logic yet (see "out of scope" in CLAUDE.md).
 */
export function ensureDecayZoneLayer(map: MapLibreMap): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  registerMapLayer(map, "overlay-under-buildings", {
    id: FILL_LAYER_ID,
    type: "fill-extrusion",
    source: SOURCE_ID,
    paint: {
      "fill-extrusion-color": DECAY_COLOR,
      "fill-extrusion-opacity": 0.4,
      "fill-extrusion-height": ZONE_EXTRUSION_HEIGHT,
      "fill-extrusion-base": 0,
      "fill-extrusion-vertical-gradient": true,
    },
  });
  // Ground-level outline of the footprint, for legibility at low pitch/zoom
  // (where the extrusion's top face can foreshorten to almost nothing).
  registerMapLayer(map, "overlay-under-buildings", {
    id: LINE_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    paint: { "line-color": DECAY_COLOR, "line-width": 2, "line-dasharray": [2, 1.5] },
  });
}

/** Each entry is one closed ring (a GeoJSON-style array of LatLng, first point repeated as last). */
export function setDecayZones(map: MapLibreMap, zones: LatLng[][]): void {
  const source = map.getSource(SOURCE_ID);
  if (!source || source.type !== "geojson") return;
  (source as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: zones.map((ring) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring.map((p) => [p.lng, p.lat])] },
      properties: {},
    })),
  });
}
