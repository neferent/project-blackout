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
