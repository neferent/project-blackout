import { GAME_SECONDS_PER_REAL_SECOND, WALKING_SPEED_KMH } from "./constants.js";

/** Game seconds required to walk `distanceKm` at the constant walking speed. */
export function gameSecondsForDistance(distanceKm: number): number {
  const gameHours = distanceKm / WALKING_SPEED_KMH;
  return gameHours * 3600;
}

/** Real seconds that elapse while `gameSeconds` of game time pass. */
export function realSecondsFromGameSeconds(gameSeconds: number): number {
  return gameSeconds / GAME_SECONDS_PER_REAL_SECOND;
}

/** Game seconds that pass while `realSeconds` of real time elapse. */
export function gameSecondsFromRealSeconds(realSeconds: number): number {
  return realSeconds * GAME_SECONDS_PER_REAL_SECOND;
}

/** Real-world milliseconds a trip of `distanceKm` will take to complete. */
export function realMsForDistance(distanceKm: number): number {
  return realSecondsFromGameSeconds(gameSecondsForDistance(distanceKm)) * 1000;
}

/**
 * Fraction of a trip completed (0..1) given its start time, its total real
 * duration, and the current time. Server is the source of truth for "now".
 */
export function tripProgress(startsAt: Date, endsAt: Date, now: Date): number {
  const total = endsAt.getTime() - startsAt.getTime();
  if (total <= 0) return 1;
  const elapsed = now.getTime() - startsAt.getTime();
  return Math.min(1, Math.max(0, elapsed / total));
}
