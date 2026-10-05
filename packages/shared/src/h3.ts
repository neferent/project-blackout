import { cellToLatLng, latLngToCell } from "h3-js";
import { INTERACTION_H3_RESOLUTION } from "./constants.js";
import type { LatLng } from "./schemas.js";

/**
 * The INTERACTION_H3_RESOLUTION cell a point falls in — the unit bases and
 * travel destinations snap to. Used identically on the server (authoritative
 * snapping) and client (instant local preview of which hex a click landed
 * in, no round-trip needed before rendering its outline).
 */
export function interactionCellForPosition(position: LatLng): string {
  return latLngToCell(position.lat, position.lng, INTERACTION_H3_RESOLUTION);
}

/** A cell's center point — bases and travel always resolve to this, never an arbitrary point within the cell. */
export function interactionCellCenter(cell: string): LatLng {
  const [lat, lng] = cellToLatLng(cell);
  return { lat, lng };
}
