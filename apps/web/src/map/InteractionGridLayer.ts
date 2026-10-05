import { cellToBoundary, polygonToCells } from "h3-js";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { INTERACTION_H3_RESOLUTION } from "@blackout/shared";
import { registerMapLayer } from "./layerRegistry.js";

const SOURCE_ID = "interaction-grid";
const LINE_LAYER_ID = "interaction-grid-line";

// Res 11 cells are small enough that a viewport's worth balloons fast at low
// zoom — stays hidden until zoomed in close enough to both read individual
// hexes and keep polygonToCells cheap.
const MIN_ZOOM = 15;

const MAX_LINE_OPACITY = 0.06;

// A zoom-based paint expression only fades smoothly if the camera actually
// takes multiple frames to cross the threshold zoom level — a single scroll
// tick or a double-click zoom can jump straight past it, so the "fade" never
// gets a chance to render. Animate opacity on a fixed clock instead, decoupled
// from how fast the zoom itself changes.
const FADE_DURATION_MS = 400;

/**
 * A permanent, faint outline of every INTERACTION_H3_RESOLUTION hex in the
 * current viewport — the grid bases and travel destinations actually snap to
 * (see packages/shared/src/h3.ts) — always visible once zoomed in, not just
 * wherever a danger tier or destination highlight happens to draw it.
 */
export function ensureInteractionGridLayer(map: MapLibreMap): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  // "overlay-under-buildings": registering before "buildings" relies on painter's algorithm —
  // buildings draw over whatever grid lines their footprint covers, so the grid reads as
  // lying on the ground and getting occluded by buildings in front of it, same convention as
  // AreaDangerLayer.
  registerMapLayer(map, "overlay-under-buildings", {
    id: LINE_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    paint: { "line-color": "#4fc3d9", "line-width": 1, "line-opacity": 0 },
  });

  const clearData = () => {
    const source = map.getSource(SOURCE_ID);
    if (source && source.type === "geojson") {
      (source as GeoJSONSource).setData({ type: "FeatureCollection", features: [] });
    }
  };

  const loadCells = () => {
    const source = map.getSource(SOURCE_ID);
    if (!source || source.type !== "geojson") return;

    const bounds = map.getBounds();
    const loop: [number, number][] = [
      [bounds.getNorth(), bounds.getWest()],
      [bounds.getNorth(), bounds.getEast()],
      [bounds.getSouth(), bounds.getEast()],
      [bounds.getSouth(), bounds.getWest()],
    ];
    const cells = polygonToCells([loop], INTERACTION_H3_RESOLUTION, false);

    (source as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: cells.map((cell) => ({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [cellToBoundary(cell, true)] },
        properties: {},
      })),
    });
  };

  let displayedOpacity = 0;
  let fadeRafId: number | null = null;

  const animateOpacityTo = (target: number) => {
    if (fadeRafId !== null) cancelAnimationFrame(fadeRafId);

    const start = displayedOpacity;
    const startTime = performance.now();

    const step = (now: number) => {
      // rAF's timestamp is when the current frame started, which can be slightly earlier than
      // `startTime` (captured mid-frame via performance.now() in the same tick) — without the
      // lower clamp here, that goes negative on the very first step and, combined with target
      // 0 or start 0, produces a line-opacity just under 0, which MapLibre rejects outright.
      const t = Math.min(1, Math.max(0, (now - startTime) / FADE_DURATION_MS));
      displayedOpacity = start + (target - start) * t;
      map.setPaintProperty(LINE_LAYER_ID, "line-opacity", displayedOpacity);

      if (t < 1) {
        fadeRafId = requestAnimationFrame(step);
      } else {
        fadeRafId = null;
        if (target === 0) clearData();
      }
    };

    fadeRafId = requestAnimationFrame(step);
  };

  let isVisible = map.getZoom() >= MIN_ZOOM;
  if (isVisible) {
    loadCells();
    animateOpacityTo(MAX_LINE_OPACITY);
  }

  const update = () => {
    const shouldBeVisible = map.getZoom() >= MIN_ZOOM;

    if (shouldBeVisible && !isVisible) {
      loadCells();
      animateOpacityTo(MAX_LINE_OPACITY);
    } else if (!shouldBeVisible && isVisible) {
      animateOpacityTo(0);
    } else if (shouldBeVisible) {
      loadCells();
    }

    isVisible = shouldBeVisible;
  };

  map.on("moveend", update);
}
