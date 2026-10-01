import type { BuildingLookup, LatLng } from "@blackout/shared";
import { apiClient } from "../api/client.js";

/**
 * What's at a clicked point — delegates to the API, which resolves it from
 * the `building_lookups` cache (point-in-polygon via PostGIS) before falling
 * back to an Overpass query, so repeat lookups near the same building don't
 * re-hit Overpass at all.
 */
export async function findBuildingAt(position: LatLng): Promise<BuildingLookup | null> {
  return apiClient.post<BuildingLookup | null>("/buildings/lookup", { position });
}

/** OSM allows semicolon-separated multi-values on a single tag (e.g. `shop=greenhouse;retail`). */
function humanize(value: string): string {
  return value
    .split(";")
    .map((part) => {
      const spaced = part.trim().replace(/_/g, " ");
      return spaced.charAt(0).toUpperCase() + spaced.slice(1);
    })
    .join(", ");
}

/** A short human-readable label, e.g. "Walmart Supercenter — Supermarket". */
export function describeBuilding(building: BuildingLookup): string {
  const label = building.shop
    ? humanize(building.shop)
    : building.amenity
      ? humanize(building.amenity)
      : building.building && building.building !== "yes"
        ? humanize(building.building)
        : "Building (unclassified)";
  return building.name ? `${building.name} — ${label}` : label;
}
