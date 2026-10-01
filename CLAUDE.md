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
- Building/place classification on click (`apps/web/src/features/travel/TravelPanel.vue`,
  `describeDestination`) tries Overpass's `is_in()`/`pivot` first
  (`apps/web/src/geo/overpass.ts`) — true point-in-polygon containment against the way/
  relation whose footprint actually contains the click. **Don't switch this to Nominatim's
  reverse endpoint alone**: that does a nearest-*point* search, which reliably picks the
  wrong sub-feature for big-box stores mapped with separate department nodes (pharmacy,
  garden center, ...) near the main building — verified against live Walmart OSM data.
  Nominatim reverse (`apps/web/src/geo/nominatim.ts`, `describePlace`) is kept only as a
  fallback for points Overpass finds no polygon for. Neither reads vector-tile data —
  OpenFreeMap's OpenMapTiles `building` layer is geometry-only (for 3D extrusion) and
  carries no `shop=*`/`amenity=*` tags. Both external calls are self-throttled
  client-side (Nominatim 1 req/sec per its usage policy; Overpass 1 req/1.5s as a
  good-citizen limit on the free public instance).

## Out of scope (don't build unless asked)

Scavenging, inventory, crafting, shelters/devices, real encounters, NPCs, multiplayer,
deployment.

The power-grid danger mechanic (per-building `connectedToGrid` state, the `disconnect`
action, and `DangerProvider` proximity to substations/plants) is now in scope — it's
partially built, see `apps/api/src/services/dangerProvider.ts` and
`apps/api/src/actions/disconnect.ts`. Rendering it (Phase 3: map layers, a disconnect
control in the building-lookup UI) is not done yet.
