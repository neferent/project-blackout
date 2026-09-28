import type { LatLng } from "./schemas.js";

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Interpolates a point along a GeoJSON LineString's coordinates ([lng, lat]
 * pairs) at `fraction` (0..1) of its total length. Used both server-side to
 * resolve a player's current position on read, and client-side to animate
 * the marker smoothly between server syncs.
 */
export function interpolateAlongLine(coordinates: [number, number][], fraction: number): LatLng {
  if (coordinates.length === 0) {
    throw new Error("Cannot interpolate an empty line");
  }
  const clamped = Math.min(1, Math.max(0, fraction));
  const points = coordinates.map(([lng, lat]) => ({ lat, lng }));
  if (points.length === 1 || clamped === 0) return points[0];
  if (clamped === 1) return points[points.length - 1];

  const segmentLengths: number[] = [];
  let totalKm = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const length = haversineKm(points[i], points[i + 1]);
    segmentLengths.push(length);
    totalKm += length;
  }
  if (totalKm === 0) return points[0];

  const targetKm = clamped * totalKm;
  let coveredKm = 0;
  for (let i = 0; i < segmentLengths.length; i++) {
    const segmentKm = segmentLengths[i];
    if (coveredKm + segmentKm >= targetKm || i === segmentLengths.length - 1) {
      const segmentFraction = segmentKm === 0 ? 0 : (targetKm - coveredKm) / segmentKm;
      const a = points[i];
      const b = points[i + 1];
      return {
        lat: a.lat + (b.lat - a.lat) * segmentFraction,
        lng: a.lng + (b.lng - a.lng) * segmentFraction,
      };
    }
    coveredKm += segmentKm;
  }

  return points[points.length - 1];
}
