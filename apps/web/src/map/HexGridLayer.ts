import { cellToBoundary, cellToChildren, gridRing, latLngToCell, polygonToCells } from "h3-js";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { LatLng } from "@blackout/shared";
import { registerMapLayer } from "./layerRegistry.js";

/**
 * Debug-only overrides — resolution 9 is the real game constant
 * (H3_RESOLUTION, packages/shared/src/constants.ts), used for actual danger
 * scoring. This file is just a visual probe, so it's free to try different
 * resolutions without touching that shared constant.
 *
 * Two nested grids, per the current "area vs. interaction cell" design idea:
 * res 10 ("area") is the coarser outer grid a danger tier (safe/slightly
 * dangerous/very dangerous/off-limits) would paint over; res 11
 * ("interaction") is the finer grid nested inside each area cell that a
 * player would actually act within.
 */
const AREA_RESOLUTION = 10;
const INTERACTION_RESOLUTION = 11;

/**
 * Registers the (initially empty) source/layer for one zoom-gated H3 grid
 * outline, redrawn on every moveend from whatever's in the current viewport.
 */
function ensureGridLineLayer(map: MapLibreMap, idPrefix: string, resolution: number, color: string, minZoom: number): void {
  const sourceId = `${idPrefix}-grid`;
  if (map.getSource(sourceId)) return;

  map.addSource(sourceId, { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  registerMapLayer(map, "overlay-under-buildings", {
    id: `${idPrefix}-grid-line`,
    type: "line",
    source: sourceId,
    paint: { "line-color": color, "line-width": 1, "line-opacity": 0.2 },
  });

  const update = () => {
    const source = map.getSource(sourceId);
    if (!source || source.type !== "geojson") return;

    if (map.getZoom() < minZoom) {
      (source as GeoJSONSource).setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const bounds = map.getBounds();
    const loop: [number, number][] = [
      [bounds.getNorth(), bounds.getWest()],
      [bounds.getNorth(), bounds.getEast()],
      [bounds.getSouth(), bounds.getEast()],
      [bounds.getSouth(), bounds.getWest()],
    ];
    const cells = polygonToCells([loop], resolution, false);

    (source as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: cells.map((cell) => ({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [cellToBoundary(cell, true)] },
        properties: {},
      })),
    });
  };

  map.on("moveend", update);
  update();
}

/**
 * Debug/preview only — lays the "interaction" (res 11) H3 grid over the real
 * map. The "area" (res 10) grid's outline is intentionally not drawn here
 * anymore — only its highlight fills (ensureHexHighlightGroup) are, since
 * area tiers are meant to read as colored regions, not grid lines. Not wired
 * into any game mechanic.
 */
export function ensureHexGridLayer(map: MapLibreMap): void {
  // Res 11 cells are ~1/7th the area of res 10 (itself already finer than the real game's res
  // 9), so a viewport's worth balloons fast — needs to stay hidden until zoomed in further
  // than the old area grid threshold before it's both legible and cheap to compute.
  ensureGridLineLayer(map, "hex-interaction", INTERACTION_RESOLUTION, "#3fc98f", 15);
}

function cellsToFeatureCollection(cells: Iterable<string>) {
  return {
    type: "FeatureCollection" as const,
    features: [...cells].map((cell) => ({
      type: "Feature" as const,
      geometry: { type: "Polygon" as const, coordinates: [cellToBoundary(cell, true)] },
      properties: { cell },
    })),
  };
}

function setSourceData(map: MapLibreMap, sourceId: string, cells: Iterable<string>): void {
  const source = map.getSource(sourceId);
  if (!source || source.type !== "geojson") return;
  (source as GeoJSONSource).setData(cellsToFeatureCollection(cells));
}

/**
 * Renders each AREA_RESOLUTION cell as the mosaic of its INTERACTION_RESOLUTION children
 * instead of as one big polygon — so the highlighted area's edges snap to the finer grid a
 * player would actually act within, rather than cutting through it.
 */
function expandToInteractionCells(areaCells: Iterable<string>): string[] {
  return [...areaCells].flatMap((cell) => cellToChildren(cell, INTERACTION_RESOLUTION));
}

/**
 * One color-keyed "center hex + fading rings" probe group — each power
 * source category (substations, plants, ...) gets its own instance so they
 * can be told apart on the map and don't clobber each other's sources.
 */
export interface HexHighlightGroup {
  setPoints(map: MapLibreMap, points: LatLng[]): void;
}

/** Registers the (initially empty) sources/layers for one highlight group. */
export function ensureHexHighlightGroup(map: MapLibreMap, idPrefix: string, color: string): HexHighlightGroup {
  const centerSourceId = `${idPrefix}-highlight`;
  const ring1SourceId = `${idPrefix}-highlight-ring1`;
  const ring2SourceId = `${idPrefix}-highlight-ring2`;

  if (!map.getSource(centerSourceId)) {
    // Ring layers registered before the center-hex layer so the solid center fill paints on
    // top where rings from different points (or different groups) overlap it.
    map.addSource(ring2SourceId, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    registerMapLayer(map, "overlay-under-buildings", {
      id: `${idPrefix}-highlight-ring2-fill`,
      type: "fill",
      source: ring2SourceId,
      paint: { "fill-color": color, "fill-opacity": 0.08 },
    });

    map.addSource(ring1SourceId, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    registerMapLayer(map, "overlay-under-buildings", {
      id: `${idPrefix}-highlight-ring1-fill`,
      type: "fill",
      source: ring1SourceId,
      paint: { "fill-color": color, "fill-opacity": 0.2 },
    });

    map.addSource(centerSourceId, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    registerMapLayer(map, "overlay-under-buildings", {
      id: `${idPrefix}-highlight-fill`,
      type: "fill",
      source: centerSourceId,
      paint: { "fill-color": color, "fill-opacity": 0.4 },
    });
  }

  return {
    /**
     * Fills in whichever AREA_RESOLUTION hex each given point falls in, plus
     * the ring of neighbors touching it (gridRing distance 1) in a fainter
     * shade, and the next ring out (distance 2) fainter still. Rings are
     * hollow (gridRing only returns cells at exactly that distance, not the
     * cells inside it too), and de-duplicated per shade — overlapping points
     * don't double-darken a shared ring cell. Each area cell is rendered as
     * its mosaic of INTERACTION_RESOLUTION children (see
     * expandToInteractionCells) rather than as one polygon, so edges snap to
     * the finer grid.
     */
    setPoints(map: MapLibreMap, points: LatLng[]): void {
      const centerCells = new Set(points.map((p) => latLngToCell(p.lat, p.lng, AREA_RESOLUTION)));
      const ring1Cells = new Set<string>();
      const ring2Cells = new Set<string>();

      for (const cell of centerCells) {
        for (const neighbor of gridRing(cell, 1)) ring1Cells.add(neighbor);
        for (const neighbor of gridRing(cell, 2)) ring2Cells.add(neighbor);
      }
      for (const cell of centerCells) {
        ring1Cells.delete(cell);
        ring2Cells.delete(cell);
      }
      for (const cell of ring1Cells) ring2Cells.delete(cell);

      setSourceData(map, centerSourceId, expandToInteractionCells(centerCells));
      setSourceData(map, ring1SourceId, expandToInteractionCells(ring1Cells));
      setSourceData(map, ring2SourceId, expandToInteractionCells(ring2Cells));
    },
  };
}
