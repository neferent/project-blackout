import type { PowerInfrastructureInViewportRequest, PowerInfrastructureInViewportResponse } from "@blackout/shared";
import { apiClient } from "../api/client.js";

/** Major transmission power lines and their towers intersecting the given viewport. */
export async function fetchPowerInfrastructureInViewport(
  bbox: PowerInfrastructureInViewportRequest,
): Promise<PowerInfrastructureInViewportResponse> {
  return apiClient.post<PowerInfrastructureInViewportResponse>("/infrastructure/power-lines/in-viewport", bbox);
}
