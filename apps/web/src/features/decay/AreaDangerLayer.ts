import { cellToBoundary, cellToChildren } from "h3-js";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { AreaCellDanger } from "@blackout/shared";
import { INTERACTION_H3_RESOLUTION } from "@blackout/shared";
import { registerMapLayer } from "../../map/layerRegistry.js";

const SOURCE_ID = "area-danger";
const FILL_LAYER_ID = "area-danger-fill";
const LINE_LAYER_ID = "area-danger-line";

// Deliberately omits "safe" — safe cells render nothing (see setAreaDanger).
const TIER_COLOR: Record<"slightly-dangerous" | "very-dangerous" | "off-limits", string> = {
  "slightly-dangerous": "#c9a53f",
  "very-dangerous": "#c9753f",
  "off-limits": "#c93f3f",
};

/**
 * Renders danger-tiered AREA_H3_RESOLUTION cells as the mosaic of their
 * INTERACTION_H3_RESOLUTION children (see expandToInteractionChildren) rather
 * than as one big polygon per area cell — so the colored region's edges
 * read as the finer grid a player actually acts within, not a smooth blob.
 * Replaces the old random-polygon "decay zone" (DecayZoneLayer.ts, removed)
 * now that danger zones are derived from real power-source proximity.
 */
export function ensureAreaDangerLayer(map: MapLibreMap): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  registerMapLayer(map, "overlay-over-buildings", {
    id: FILL_LAYER_ID,
    type: "fill",
    source: SOURCE_ID,
    paint: {
      "fill-color": [
        "match",
        ["get", "tier"],
        "slightly-dangerous",
        TIER_COLOR["slightly-dangerous"],
        "very-dangerous",
        TIER_COLOR["very-dangerous"],
        "off-limits",
        TIER_COLOR["off-limits"],
        "#000000",
      ],
      "fill-opacity": 0.35,
    },
  });
  // Thin same-color outline per interaction-cell so the mosaic's texture stays visible even
  // where adjacent cells share the same tier (and so adjacent fills don't blend into a blob).
  registerMapLayer(map, "overlay-over-buildings", {
    id: LINE_LAYER_ID,
    type: "line",
    source: SOURCE_ID,
    paint: {
      "line-color": [
        "match",
        ["get", "tier"],
        "slightly-dangerous",
        TIER_COLOR["slightly-dangerous"],
        "very-dangerous",
        TIER_COLOR["very-dangerous"],
        "off-limits",
        TIER_COLOR["off-limits"],
        "#000000",
      ],
      "line-width": 1,
      "line-opacity": 0.5,
    },
  });
}

function expandToInteractionChildren(cell: string): string[] {
  return cellToChildren(cell, INTERACTION_H3_RESOLUTION);
}

/** `cells` should come from fetchZonesInViewport — already filtered to non-safe tiers. */
export function setAreaDanger(map: MapLibreMap, cells: AreaCellDanger[]): void {
  const source = map.getSource(SOURCE_ID);
  if (!source || source.type !== "geojson") return;

  (source as GeoJSONSource).setData({
    type: "FeatureCollection",
    features: cells.flatMap(({ cell, tier }) =>
      expandToInteractionChildren(cell).map((child) => ({
        type: "Feature" as const,
        geometry: { type: "Polygon" as const, coordinates: [cellToBoundary(child, true)] },
        properties: { tier },
      })),
    ),
  });
}
