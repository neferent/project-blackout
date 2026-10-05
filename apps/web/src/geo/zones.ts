import type { BuildingsInZoneResponse, ZonesInViewportRequest, ZonesInViewportResponse } from "@blackout/shared";
import { apiClient } from "../api/client.js";

/** Every non-safe-tier AREA_H3_RESOLUTION cell intersecting the given viewport. */
export async function fetchZonesInViewport(bbox: ZonesInViewportRequest): Promise<ZonesInViewportResponse> {
  return apiClient.post<ZonesInViewportResponse>("/zones/in-viewport", bbox);
}

/** Buildings within one AREA_H3_RESOLUTION cell, resolved live from Overpass — see zones.ts route. */
export async function fetchBuildingsInCell(cell: string): Promise<BuildingsInZoneResponse> {
  return apiClient.post<BuildingsInZoneResponse>("/zones/buildings-in-cell", { cell });
}
