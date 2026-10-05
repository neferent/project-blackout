import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { MapLayerSlot } from "./layerRegistry.js";

function slotted(slot: MapLayerSlot) {
  return { metadata: { slot } };
}

const BUILDING_OPACITY = 0.9;

function buildLayers(): LayerSpecification[] {
  const layers: LayerSpecification[] = [
    { id: "background", type: "background", paint: { "background-color": "#0b0c0d" }, ...slotted("basemap") },
    {
      id: "landcover",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landcover",
      paint: { "fill-color": "#0c1a10", "fill-opacity": 0.6 },
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
      paint: { "fill-color": "#0f2016", "fill-opacity": 0.5 },
      ...slotted("basemap"),
    },
    // Dedicated line layer for the same reason as water-stroke below: fill-outline-color
    // alone is unreliable (1px, antialiased only, no width control).
    {
      id: "park-stroke",
      type: "line",
      source: "openmaptiles",
      "source-layer": "park",
      paint: { "line-color": "#152a1c", "line-width": 1 },
      ...slotted("basemap"),
    },
    {
      id: "water",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      paint: { "fill-color": "#0a1420", "fill-outline-color": "#1a2a3a" },
      ...slotted("basemap"),
    },
    // fill-outline-color on the fill layer above is unreliable (1px, antialiased only,
    // no width control) — a dedicated line layer over the same source-layer gives a
    // real, controllable stroke around every water body.
    {
      id: "water-stroke",
      type: "line",
      source: "openmaptiles",
      "source-layer": "water",
      paint: { "line-color": "#132330", "line-width": 1 },
      ...slotted("basemap"),
    },
    {
      id: "waterway",
      type: "line",
      source: "openmaptiles",
      "source-layer": "waterway",
      paint: { "line-color": "#141414", "line-width": 1 },
      ...slotted("basemap"),
    },
    {
      id: "boundary",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      filter: ["<=", "admin_level", 4],
      paint: { "line-color": "#3a3a3a", "line-width": 0.75, "line-dasharray": [2, 2] },
      ...slotted("basemap"),
    },
    // "overlay-under-buildings", not grouped with the rest of the basemap: roads still need
    // their own slot after the ground layers, drawn before the building fill so a building
    // simply paints over whatever road is under its footprint (plain painter's-algorithm
    // draw order — the static array order below is what actually controls it; the slot
    // metadata only governs where layers added later via registerMapLayer get inserted).
    // A soft, blurred halo just under the (near-black) road line itself, slightly wider and
    // barely lighter than the background. Against a background this dark, solid black roads
    // would be invisible; the halo is what reads as the road "hovering" a touch above the flat
    // ground rather than being painted flush onto it.
    {
      id: "road-minor-shadow",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["in", "class", "minor", "service", "track"],
      paint: {
        "line-color": "#1c1c1c",
        "line-opacity": 0.4,
        "line-blur": 2,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 16, 4, 18, 7],
      },
      ...slotted("overlay-under-buildings"),
    },
    {
      id: "road-minor",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      // "path" (footway/path/cycleway/steps — i.e. sidewalks) is deliberately left off: Valhalla
      // routes pedestrians over that data regardless of what's rendered here, but drawing every
      // sidewalk/crossing/alley alongside the roads it hugs was most of the map's visual clutter.
      filter: ["in", "class", "minor", "service", "track"],
      paint: {
        "line-color": "#050505",
        // Width scales with zoom so each line reads as the full road surface rather than a
        // thin wire. This also matters for divided roads (see road-major below): OSM maps
        // each carriageway of a dual-carriageway road as its own parallel way, and without
        // zoom-scaled width those two ways render as two visibly separate thin lines instead
        // of one road.
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 16, 2.5, 18, 5],
      },
      ...slotted("overlay-under-buildings"),
    },
    // Ramps/slip roads (interchange links) share their parent's "class" in OpenMapTiles
    // (e.g. a motorway on-ramp is still class "motorway"), so without this split they'd
    // render at full road-major width/color — at any real interchange that's a dozen
    // overlapping full-strength lines. Drawn thinner/dimmer, and before road-major, so the
    // through-road still reads clearly on top.
    {
      id: "road-ramp",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: [
        "all",
        ["in", "class", "primary", "secondary", "tertiary", "trunk", "motorway"],
        ["==", "ramp", 1],
      ],
      paint: {
        "line-color": "#262626",
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.75, 16, 1.5, 18, 3],
      },
      ...slotted("overlay-under-buildings"),
    },
    // Same hover-halo treatment as road-minor-shadow above, scaled to road-major's width.
    {
      id: "road-major-shadow",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: [
        "all",
        ["in", "class", "primary", "secondary", "tertiary", "trunk", "motorway"],
        ["!=", "ramp", 1],
      ],
      paint: {
        "line-color": "#1c1c1c",
        "line-opacity": 0.4,
        "line-blur": 2,
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 3, 16, 6, 18, 12],
      },
      ...slotted("overlay-under-buildings"),
    },
    {
      id: "road-major",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: [
        "all",
        ["in", "class", "primary", "secondary", "tertiary", "trunk", "motorway"],
        ["!=", "ramp", 1],
      ],
      paint: {
        "line-color": "#050505",
        // Wider than road-minor and grows faster with zoom, both because major roads are
        // physically wider and so the two carriageways of a divided road (mapped as separate
        // parallel OSM ways) merge visually into one band instead of reading as "lanes".
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 16, 4, 18, 9],
      },
      ...slotted("overlay-under-buildings"),
    },
    // Flat, stylized 2D footprints — no fill-extrusion. Taller buildings still read as more
    // scorched/damaged (darker), squat ones as more intact (lighter, slightly warmer), free
    // variation from data already on the layer, no new assets. OpenMapTiles only carries
    // render_height on some buildings; coalesce to a plausible low-rise default for the
    // untagged ones.
    {
      id: "building",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: 13,
      paint: {
        "fill-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "render_height"], 6],
          0,
          "#2a2a2a",
          15,
          "#1e1e1e",
          40,
          "#101010",
        ],
        "fill-opacity": BUILDING_OPACITY,
      },
      ...slotted("buildings"),
    },
    {
      id: "place-labels",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
      },
      paint: { "text-color": "#9a9a9a", "text-halo-color": "#0b0c0d", "text-halo-width": 1 },
      ...slotted("labels"),
    },
  ];

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
    layers: buildLayers(),
  };
}
