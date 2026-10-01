import type { LatLng, PowerInfrastructureInViewportRequest, PowerInfrastructureInViewportResponse } from "@blackout/shared";
import { apiClient } from "../api/client.js";

/** Major transmission power lines and their towers intersecting the given viewport. */
export async function fetchPowerInfrastructureInViewport(
  bbox: PowerInfrastructureInViewportRequest,
): Promise<PowerInfrastructureInViewportResponse> {
  return apiClient.post<PowerInfrastructureInViewportResponse>("/infrastructure/power-lines/in-viewport", bbox);
}

/** Debug probe only — every substation in the BC import, no viewport filtering. */
export async function fetchAllSubstations(): Promise<LatLng[]> {
  const { substations } = await apiClient.get<{ substations: LatLng[] }>("/infrastructure/power-lines/substations");
  return substations;
}

/** Debug probe only — every power plant (dams, coal/gas, hydro, ...) in the BC import. */
export async function fetchAllPowerPlants(): Promise<LatLng[]> {
  const { plants } = await apiClient.get<{ plants: LatLng[] }>("/infrastructure/power-lines/plants");
  return plants;
}
