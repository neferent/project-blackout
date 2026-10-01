/** Game-world walking speed, in game kilometers per game hour. */
export const WALKING_SPEED_KMH = 5;

/**
 * How many game-seconds pass per real-world second.
 * 1 real minute = 1 game hour  =>  60 real seconds = 3600 game seconds  =>  ratio = 60.
 */
export const GAME_SECONDS_PER_REAL_SECOND = 60;

/** H3 resolution used for a player's current cell. */
export const H3_RESOLUTION = 9;

/** Nominatim usage policy: no more than 1 request/second, always set an identifying User-Agent. */
export const NOMINATIM_MIN_REQUEST_INTERVAL_MS = 1000;

/** Game seconds a `disconnect` action occupies — a fixed cost, unlike travel's distance-based one. */
export const DISCONNECT_ACTION_GAME_SECONDS = 30 * 60;

/** How close (meters) a player must be to a building to disconnect it from the grid. */
export const DISCONNECT_MAX_DISTANCE_METERS = 30;
