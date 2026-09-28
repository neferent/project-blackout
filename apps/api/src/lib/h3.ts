import { latLngToCell } from "h3-js";
import { H3_RESOLUTION } from "@blackout/shared";
import type { LatLng } from "@blackout/shared";

export function cellForPosition(position: LatLng): string {
  return latLngToCell(position.lat, position.lng, H3_RESOLUTION);
}
