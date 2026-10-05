/** Game-world walking speed, in game kilometers per game hour. */
export const WALKING_SPEED_KMH = 5;

/**
 * How many game-seconds pass per real-world second.
 * 1 real minute = 1 game hour  =>  60 real seconds = 3600 game seconds  =>  ratio = 60.
 */
export const GAME_SECONDS_PER_REAL_SECOND = 60;

/** H3 resolution used for a player's current cell. */
export const H3_RESOLUTION = 9;

/**
 * The two nested H3 resolutions danger tiers/interaction are built on (see
 * dangerProvider.ts). AREA cells (~0.015 km² at res 10) are what safe/
 * slightly-dangerous/very-dangerous/off-limits is scored per; each AREA cell
 * is a mosaic of INTERACTION cells (res 11, ~1/7th the area) — the finer
 * grid a player actually acts within. Deliberately finer than H3_RESOLUTION
 * (player position tracking), a separate concern.
 */
export const AREA_H3_RESOLUTION = 10;
export const INTERACTION_H3_RESOLUTION = 11;

/** Nominatim usage policy: no more than 1 request/second, always set an identifying User-Agent. */
export const NOMINATIM_MIN_REQUEST_INTERVAL_MS = 1000;

/** Game seconds a `disconnect` action occupies — a fixed cost, unlike travel's distance-based one. */
export const DISCONNECT_ACTION_GAME_SECONDS = 30 * 60;

/** How close (meters) a player must be to a building to disconnect it from the grid. */
export const DISCONNECT_MAX_DISTANCE_METERS = 30;

// Every base is a hexagon made of BASE_HEX_RADIUS rings of hex cells (flat-top, axial
// coordinates) — 3*R^2 + 3*R + 1 cells total, 127 at R=6. Shared because both the client
// preview (hexGrid.ts) and the server's create-player validation need the same board size.
export const BASE_HEX_RADIUS = 6;

/** A base with no (or almost no) building cells has nothing to shelter it — hard minimum. */
export const MIN_BASE_BUILDING_CELLS = 3;
