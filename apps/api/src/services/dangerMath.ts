import type { DangerTier } from "@blackout/shared";

/** Full danger (1) at or within this distance of a live source. */
export const DANGER_MAX_METERS = 50;
/** No danger (0) at or beyond this distance — linear falloff in between. */
export const DANGER_FALLOFF_METERS = 300;

/** Pure so it's unit-testable without a database — see dangerProvider.ts for how it's used. */
export function dangerFromDistanceMeters(distanceM: number): number {
  if (distanceM <= DANGER_MAX_METERS) return 1;
  if (distanceM >= DANGER_FALLOFF_METERS) return 0;
  return 1 - (distanceM - DANGER_MAX_METERS) / (DANGER_FALLOFF_METERS - DANGER_MAX_METERS);
}

/**
 * Buckets the continuous 0-1 danger value into the four tiers an AREA_H3_RESOLUTION cell is
 * colored by (see HexGridLayer-derived AreaDangerLayer.ts on the client). Thirds of the
 * falloff range, rather than a separate distance table, so there's one source of truth for
 * "how dangerous" between DANGER_MAX_METERS and DANGER_FALLOFF_METERS.
 */
export function dangerTierFromValue(value: number): DangerTier {
  if (value >= 1) return "off-limits";
  if (value >= 2 / 3) return "very-dangerous";
  if (value >= 1 / 3) return "slightly-dangerous";
  return "safe";
}

export function dangerTierFromDistanceMeters(distanceM: number): DangerTier {
  return dangerTierFromValue(dangerFromDistanceMeters(distanceM));
}
