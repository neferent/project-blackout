import type { BuildingsInZoneResponse, ZonesInViewportRequest, ZonesInViewportResponse } from "@blackout/shared";
import { apiClient } from "../api/client.js";

/** Shapes only (not building data) for every danger zone intersecting the given viewport. */
export async function fetchZonesInViewport(bbox: ZonesInViewportRequest): Promise<ZonesInViewportResponse> {
  return apiClient.post<ZonesInViewportResponse>("/zones/in-viewport", bbox);
}

/** A zone's persisted building list (resolved once at zone-creation time — no live Overpass call). */
export async function fetchZoneBuildings(zoneId: string): Promise<BuildingsInZoneResponse> {
  return apiClient.get<BuildingsInZoneResponse>(`/zones/${zoneId}/buildings`);
}
