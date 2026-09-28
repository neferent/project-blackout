import type { StyleSpecification } from "maplibre-gl";
import type { MapLayerSlot } from "./layerRegistry.js";

function slotted(slot: MapLayerSlot) {
  return { metadata: { slot } };
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
    sources: {
      openmaptiles: {
        type: "vector",
        url: tileSourceUrl,
      },
    },
    glyphs: glyphsUrl,
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#0b0c0d" }, ...slotted("basemap") },
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
      {
        id: "water",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "water",
        paint: { "fill-color": "#0e1416" },
        ...slotted("basemap"),
      },
      {
        id: "waterway",
        type: "line",
        source: "openmaptiles",
        "source-layer": "waterway",
        paint: { "line-color": "#0e1416", "line-width": 1 },
        ...slotted("basemap"),
      },
      {
        id: "road-minor",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["in", "class", "minor", "service", "track", "path"],
        paint: { "line-color": "#2b2b29", "line-width": 1 },
        ...slotted("basemap"),
      },
      {
        id: "road-major",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["in", "class", "primary", "secondary", "tertiary", "trunk", "motorway"],
        paint: { "line-color": "#3a3a35", "line-width": 1.5 },
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
        type: "fill",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 13,
        paint: { "fill-color": "#1a1a1a", "fill-outline-color": "#2a2a28" },
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
        paint: { "text-color": "#8a8578", "text-halo-color": "#0b0c0d", "text-halo-width": 1 },
        ...slotted("labels"),
      },
    ],
  };
}
