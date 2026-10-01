import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { MapLayerSlot } from "./layerRegistry.js";

function slotted(slot: MapLayerSlot) {
  return { metadata: { slot } };
}

// Base (non-flickering) glow opacities, and the pathOpacity each style variant renders roads
// at — exported so MapView.vue's flicker loop can compute each map's target opacity without
// duplicating these numbers.
export const ROAD_MINOR_GLOW_OPACITY = 0.22;
export const ROAD_MAJOR_GLOW_OPACITY = 0.25;
export const MAIN_PATH_OPACITY = 1;
export const DISTORTED_PATH_OPACITY = 0.15;

interface StyleVariantOptions {
  /** Whether to include the place-name symbol layer. */
  includeLabels: boolean;
  /** line-opacity applied to the road layers — lower to fade paths out. */
  pathOpacity: number;
}

function buildLayers({ includeLabels, pathOpacity }: StyleVariantOptions): LayerSpecification[] {
  const layers: LayerSpecification[] = [
    { id: "background", type: "background", paint: { "background-color": "#0b0c0d" }, ...slotted("basemap") },
    // Speckle texture over the whole ground plane, underneath land/water/roads/buildings.
    // The "ground-noise-pattern" image is registered on each Map instance at runtime (see
    // MapView.vue) via createGroundNoiseImage — MapLibre renders nothing here until then.
    {
      id: "ground-noise",
      type: "background",
      paint: { "background-pattern": "ground-noise-pattern", "background-opacity": 0.25 },
      ...slotted("basemap"),
    },
    {
      id: "landcover",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landcover",
      paint: { "fill-color": "#111213", "fill-opacity": 0.6 },
      ...slotted("basemap"),
    },
    {
      id: "landuse",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landuse",
      paint: { "fill-color": "#131414", "fill-opacity": 0.5 },
      ...slotted("basemap"),
    },
    {
      id: "park",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "park",
      paint: { "fill-color": "#141814", "fill-opacity": 0.5 },
      ...slotted("basemap"),
    },
    // Dried/cracked ground texture (see noisePattern.ts's Voronoi-boundary technique).
    // Placed after landcover/landuse/park so it shows on top of every land classification,
    // but still before "water" so water paints back over it — a background layer would
    // otherwise get buried under those fills' opacity, or (placed after water) show through
    // on top of water, which doesn't make sense. "cracked-earth-pattern" is registered
    // per-Map-instance at runtime in MapView.vue.
    {
      id: "ground-cracks",
      type: "background",
      paint: { "background-pattern": "cracked-earth-pattern", "background-opacity": 0.5 },
      ...slotted("basemap"),
    },
    {
      id: "water",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      paint: { "fill-color": "#0e1416", "fill-outline-color": "#2a4a46" },
      ...slotted("basemap"),
    },
    // Rippled texture over the flat water fill (see noisePattern.ts); "water-ripple-pattern"
    // is registered per-Map-instance at runtime in MapView.vue.
    {
      id: "water-ripple",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      paint: { "fill-pattern": "water-ripple-pattern", "fill-opacity": 0.25 },
      ...slotted("basemap"),
    },
    {
      id: "waterway",
      type: "line",
      source: "openmaptiles",
      "source-layer": "waterway",
      paint: { "line-color": "#0e1416", "line-width": 1, "line-opacity": pathOpacity },
      ...slotted("basemap"),
    },
    // Glow layers sit directly under their crisp counterpart and use line-blur for a soft
    // halo (MapLibre's built-in glow technique — no stacked/duplicate rendering needed).
    // Scaled by pathOpacity so the glow fades along with the path on the distorted variant.
    {
      id: "road-minor-glow",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["in", "class", "minor", "service", "track", "path"],
      paint: {
        "line-color": "#8a9a2a",
        "line-width": 7,
        "line-blur": 5,
        "line-opacity": ROAD_MINOR_GLOW_OPACITY * pathOpacity,
      },
      ...slotted("basemap"),
    },
    {
      id: "road-minor",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["in", "class", "minor", "service", "track", "path"],
      paint: { "line-color": "#2b2b29", "line-width": 1, "line-opacity": pathOpacity },
      ...slotted("basemap"),
    },
    {
      id: "road-major-glow",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["in", "class", "primary", "secondary", "tertiary", "trunk", "motorway"],
      paint: {
        "line-color": "#a8b83a",
        "line-width": 9,
        "line-blur": 6,
        "line-opacity": ROAD_MAJOR_GLOW_OPACITY * pathOpacity,
      },
      ...slotted("basemap"),
    },
    {
      id: "road-major",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["in", "class", "primary", "secondary", "tertiary", "trunk", "motorway"],
      paint: { "line-color": "#3a3a35", "line-width": 1.5, "line-opacity": pathOpacity },
      ...slotted("basemap"),
    },
    {
      id: "boundary",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      filter: ["<=", "admin_level", 4],
      paint: { "line-color": "#3a2f2a", "line-width": 0.75, "line-dasharray": [2, 2] },
      ...slotted("basemap"),
    },
    {
      id: "building",
      type: "fill-extrusion",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: 13,
      paint: {
        // Taller buildings read as more scorched/damaged (darker), squat ones as more
        // intact (lighter, slightly warmer) — free variation from data already on the
        // layer, no new assets. Same coalesce-to-6 fallback as fill-extrusion-height below.
        "fill-extrusion-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "render_height"], 6],
          0,
          "#2c2a22",
          15,
          "#1e1e1c",
          40,
          "#101010",
        ],
        // OpenMapTiles only carries render_height on some buildings; fall
        // back to a plausible low-rise default so untagged buildings still
        // extrude instead of staying flat.
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.9,
        // Extrude in gradually from minzoom so buildings don't pop.
        "fill-extrusion-vertical-gradient": true,
      },
      ...slotted("buildings"),
    },
    // Rubble/debris texture-mapped onto the same extrusion geometry as "building" (matching
    // height/base so the two coincide exactly), via fill-extrusion-pattern — the only way to
    // put a pattern on an extruded roof/wall face; a flat fill layer at ground level would
    // render underneath the extrusion and never be visible at a pitched angle.
    // "roof-debris-pattern" is registered per-Map-instance at runtime in MapView.vue.
    {
      id: "building-debris",
      type: "fill-extrusion",
      source: "openmaptiles",
      "source-layer": "building",
      // Higher than the base "building" layer's minzoom (13) — debris is a close-up detail,
      // not something that should be visible while still zoomed out over the whole city.
      minzoom: 14,
      paint: {
        "fill-extrusion-pattern": "roof-debris-pattern",
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.26,
      },
      ...slotted("buildings"),
    },
  ];

  if (includeLabels) {
    layers.push({
      id: "place-labels",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
      },
      paint: { "text-color": "#8a8578", "text-halo-color": "#0b0c0d", "text-halo-width": 1 },
      ...slotted("labels"),
    });
  }

  return layers;
}

/**
 * Dark, desaturated "post-apocalyptic" basemap style. Layered against the
 * OpenMapTiles vector schema (what OpenFreeMap serves today). The tile
 * source URL is passed in from config so this can point at self-hosted
 * Protomaps PMTiles later without touching layer definitions. Each layer is
 * tagged with its map-layer-registry slot so dynamically added layers know
 * where to insert relative to these.
 */
export function buildMapStyle(tileSourceUrl: string, glyphsUrl: string): StyleSpecification {
  return {
    version: 8,
    sources: { openmaptiles: { type: "vector", url: tileSourceUrl } },
    glyphs: glyphsUrl,
    layers: buildLayers({ includeLabels: true, pathOpacity: MAIN_PATH_OPACITY }),
  };
}

/**
 * Variant rendered by a second, decorative MapLibre instance camera-synced to the main
 * map (see MapView.vue) and shown through the screen-space distortion filter. Drops place
 * labels (warped text is unreadable and doubles the ones from the base map) and fades
 * roads out, so the "broken" copy reads as warped terrain/buildings rather than a second
 * legible map.
 */
export function buildDistortedMapStyle(tileSourceUrl: string, glyphsUrl: string): StyleSpecification {
  return {
    version: 8,
    sources: { openmaptiles: { type: "vector", url: tileSourceUrl } },
    glyphs: glyphsUrl,
    layers: buildLayers({ includeLabels: false, pathOpacity: DISTORTED_PATH_OPACITY }),
  };
}
