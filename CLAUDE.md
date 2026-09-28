# Project Blackout

Shared-world, location-based scavenging/crafting/trading game on the real map of Earth
(OpenStreetMap). Currently a POC: map loading, start placement, travel. See
`ARCHITECTURE.md` for how the extension points work in detail — this file is the
must-not-violate rules.

## Non-negotiable rules

- **Server is the source of truth for time.** Never trust a client-supplied timestamp or
  duration. All game-time state (personal clock, position, trip progress) is computed on
  read from stored `starts_at`/`ends_at`, not advanced by client ticks.
- **Walking speed and time ratio are constants in `packages/shared/src/constants.ts`**
  (`WALKING_SPEED_KMH`, `GAME_SECONDS_PER_REAL_SECOND`), never hard-coded elsewhere.
  Current values: 5 km/h game speed, 60:1 ratio (1 real minute = 1 game hour).
- **Never use OSM IDs as primary/foreign keys.** Players, actions, and anything else get
  server-generated UUIDs. OSM/Nominatim only ever supplies coordinates.
- **New player actions (scavenge, craft, rest, ...) are a new `ActionKind` + `ActionHandler`**,
  not a new table or a special case in the personal-clock logic. See "Action system" in
  ARCHITECTURE.md.
- **New map layers register through `registerMapLayer(map, slot, layer)`**
  (`apps/web/src/map/layerRegistry.ts`), not `map.addLayer` directly, so z-order stays
  consistent across features.
- **Routing always goes through `DangerProvider`** (`apps/api/src/services/
  dangerProvider.ts`) before calling Valhalla, even though it's a stub returning 0 today.
- **Identity is anonymous-id-in-a-header for the POC**, isolated in `apps/api/src/identity/
  anonPlayer.ts` and `apps/web/src/identity/anonPlayerId.ts`. Don't leak this scheme into
  other modules — they should only ever see a resolved player.

## Stack specifics

- pnpm monorepo: `apps/web` (Vue 3 + Vite, Pinia, TanStack Query, MapLibre GL JS), `apps/api`
  (Node + Hono), `packages/shared` (zod schemas, constants, pure game-math functions).
- Postgres + PostGIS. Drizzle ORM, SQL migrations in `apps/api/drizzle/`. H3 cells are
  computed in application code via `h3-js` and stored as plain `text` — the h3-pg Postgres
  extension is **not** installed (not bundled in the `postgis/postgis` image at time of
  writing), so don't write SQL that assumes H3 SQL functions exist.
- `apps/api/src/services/valhalla.ts` talks to a self-hosted Valhalla instance
  (`ghcr.io/valhalla/valhalla-scripted`) for pedestrian routing.
- Route/position interpolation is a pure function (`packages/shared/src/
  routeInterpolation.ts`), shared between server (authoritative resolution) and client
  (smooth animation) — keep it that way rather than duplicating the math.
- On Apple Silicon, `postgres` in `docker-compose.yml` is pinned to `platform: linux/amd64`
  (emulated) because no arm64 build of `postgis/postgis` exists yet; `valhalla` runs native
  arm64.

## Out of scope (don't build unless asked)

Buildings/classification, scavenging, inventory, crafting, shelters/devices, real danger
logic, real encounters, NPCs, multiplayer, deployment.
