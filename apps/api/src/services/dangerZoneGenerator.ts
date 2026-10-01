import type { LatLng } from "@blackout/shared";
import { stubSafeZoneProvider, type SafeZoneProvider } from "./safeZoneProvider.js";

const MIN_CORNERS = 4;
const MAX_CORNERS = 8;
const MIN_RADIUS_M = 150;
const MAX_RADIUS_M = 350;
/** A safe-zone-heavy area can exhaust a few attempts; this bounds the retry loop. */
const MAX_GENERATION_ATTEMPTS = 20;

const METERS_PER_DEGREE_LAT = 111_320;

function offsetMeters(center: LatLng, angleRad: number, radiusMeters: number): LatLng {
  const dx = Math.cos(angleRad) * radiusMeters;
  const dy = Math.sin(angleRad) * radiusMeters;
  return {
    lat: center.lat + dy / METERS_PER_DEGREE_LAT,
    lng: center.lng + dx / (METERS_PER_DEGREE_LAT * Math.cos((center.lat * Math.PI) / 180)),
  };
}

/**
 * One attempt: 4-8 random (angle, radius) corners around `center`, sorted by
 * angle so the resulting ring is always simple (non-self-intersecting), then
 * with any corner inside a safe zone dropped. Returns null if fewer than 3
 * corners survive that filter — too few to form a polygon.
 */
async function tryGenerateCorners(center: LatLng, safeZoneProvider: SafeZoneProvider): Promise<LatLng[] | null> {
  const cornerCount = MIN_CORNERS + Math.floor(Math.random() * (MAX_CORNERS - MIN_CORNERS + 1));
  const raw = Array.from({ length: cornerCount }, () => {
    const angle = Math.random() * 2 * Math.PI;
    const radius = MIN_RADIUS_M + Math.random() * (MAX_RADIUS_M - MIN_RADIUS_M);
    return { angle, point: offsetMeters(center, angle, radius) };
  }).sort((a, b) => a.angle - b.angle);

  const corners: LatLng[] = [];
  for (const { point } of raw) {
    if (!(await safeZoneProvider.isInSafeZone(point))) corners.push(point);
  }

  return corners.length >= 3 ? corners : null;
}

/**
 * Generates a new danger zone's shape around `center`: a closed ring (first
 * point repeated as last) of 3-8 corners. Retries with an entirely fresh set
 * of random corners (same center) up to MAX_GENERATION_ATTEMPTS times if
 * safe-zone overlap leaves too few to form a polygon; throws if it never
 * manages — with today's always-false safe-zone stub this can never happen,
 * but a real safe-zone layer covering most of the requested area could
 * genuinely exhaust every attempt.
 */
export async function generateDangerZone(
  center: LatLng,
  safeZoneProvider: SafeZoneProvider = stubSafeZoneProvider,
): Promise<LatLng[]> {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const corners = await tryGenerateCorners(center, safeZoneProvider);
    if (corners) return [...corners, corners[0]];
  }
  throw new Error("Could not generate a danger zone: too much safe-zone overlap near this center");
}
