import type { LatLng } from "./schemas.js";

function pointInPolygon(point: [number, number], polygon: LatLng[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Standard orientation-based segment intersection test (2D, no shared-endpoint special case needed here). */
function segmentsIntersect(
  [ax1, ay1]: [number, number],
  [ax2, ay2]: [number, number],
  [bx1, by1]: [number, number],
  [bx2, by2]: [number, number],
): boolean {
  const cross = (ox: number, oy: number, px: number, py: number, qx: number, qy: number) =>
    (px - ox) * (qy - oy) - (py - oy) * (qx - ox);

  const d1 = cross(bx1, by1, bx2, by2, ax1, ay1);
  const d2 = cross(bx1, by1, bx2, by2, ax2, ay2);
  const d3 = cross(ax1, ay1, ax2, ay2, bx1, by1);
  const d4 = cross(ax1, ay1, ax2, ay2, bx2, by2);

  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Whether a GeoJSON LineString's coordinates ([lng, lat] pairs) pass through
 * `polygon` (a closed ring of LatLng) — either by crossing an edge, or by
 * having an endpoint inside it.
 */
export function lineIntersectsPolygon(coordinates: [number, number][], polygon: LatLng[]): boolean {
  if (coordinates.some((point) => pointInPolygon(point, polygon))) return true;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const a1 = coordinates[i];
    const a2 = coordinates[i + 1];
    for (let j = 0; j < polygon.length - 1; j++) {
      const b1: [number, number] = [polygon[j].lng, polygon[j].lat];
      const b2: [number, number] = [polygon[j + 1].lng, polygon[j + 1].lat];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}
