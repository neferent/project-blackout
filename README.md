# Project Blackout — POC

A shared-world, location-based scavenging/crafting/trading game on the real map of Earth.
This is a proof of concept: map loading, start placement, and travel along real streets
with a server-authoritative game clock. See `ARCHITECTURE.md` for how it's built to extend.

## Stack

- `apps/web` — Vue 3 + TypeScript + Vite SPA (Pinia, TanStack Query, MapLibre GL JS)
- `apps/api` — Node + TypeScript + Hono
- `packages/shared` — shared types, zod schemas, game constants
- Postgres + PostGIS, Drizzle ORM
- Valhalla (pedestrian routing), self-built from an OSM extract
- Docker Compose for the whole stack

## Prerequisites

- Docker Desktop (Apple Silicon: the `postgis/postgis` image has no arm64 build yet, so
  `docker-compose.yml` pins it to `platform: linux/amd64`, which runs fine under emulation)
- Node 22+ and pnpm, only if you want to run things outside Docker (`pnpm db:generate`, tests)

## Setup

1. Copy the env file and adjust if needed:

   ```sh
   cp .env.example .env
   ```

   `VALHALLA_REGION_URL` points at a Geofabrik `.osm.pbf` extract. It defaults to British
   Columbia. Pick a smaller region if you want a faster first build — browse extracts at
   https://download.geofabrik.de/. `VITE_DEFAULT_CENTER_LAT`/`LNG` should be somewhere
   inside that extract (defaults to Vancouver, BC).

2. Start everything:

   ```sh
   docker compose up --build
   ```

   First boot will take a while: `valhalla-prep` downloads the extract and patches it
   (adding `foot=yes` to cycleways/shared paths that OSM tagging leaves foot-inaccessible,
   so pedestrian routing isn't wrongly denied a way a bike could use — see
   `docker/valhalla/patch_foot_access.py`), then `valhalla` builds routing tiles from the
   result (this can take several minutes to an hour depending on region size and machine).
   Watch `docker compose logs -f valhalla-prep valhalla` for progress. The API runs its
   Postgres migrations automatically on startup.

   Changing `VALHALLA_REGION_URL` or editing `patch_foot_access.py` after tiles already
   exist won't take effect on its own — `valhalla-prep` skips work once a patched extract
   is present, and `valhalla` is configured to reuse existing tiles. Force a rebuild with:

   ```sh
   docker compose down
   docker volume rm project-blackout_valhalla_data
   docker compose up --build
   ```

3. Open http://localhost:5180 (`WEB_PORT` in `.env`; moved off Vite's usual 5173 since
   that's commonly already taken by other projects).

## Local development (outside Docker)

```sh
pnpm install
docker compose up -d postgres valhalla   # just the backing services
pnpm --filter api db:migrate
pnpm dev:api      # apps/api on :8787
pnpm dev:web      # apps/web on :5173 (Vite's own default; pass --port to change it)
```

## Tests

```sh
pnpm test
```

Covers time/game-clock math (`packages/shared`), route interpolation
(`packages/shared`), and the personal-clock utility (`apps/api`).

## Database migrations

Schema lives in `apps/api/src/db/schema.ts`. After changing it:

```sh
pnpm --filter api db:generate   # writes SQL into apps/api/drizzle/
pnpm --filter api db:migrate    # applies it (also runs automatically in the api container)
```

## Power-grid data import (optional)

Most power-grid data (major lines/towers) is fetched live from Overpass and cached on
demand — no import needed for that. For a region you want fully pre-loaded (substations,
plants, and the full road hierarchy used to infer local distribution — see
`project_power_grid_danger_system` design notes), run a one-off bulk import from a
Geofabrik `.osm.pbf` extract:

```sh
docker compose --profile import run --rm power-grid-import   # reuses VALHALLA_REGION_URL
pnpm --filter api import:power-grid                           # upserts staging into final tables
```

The first command downloads the extract (cached in the `power_grid_import_cache` volume)
and runs `osm2pgsql` with a flex-output style (`docker/osm2pgsql/style.lua`) into a
throwaway `osm_import` staging schema; the second upserts from there into the
drizzle-owned `power_lines`/`power_towers`/`power_substations`/`power_plants`/`roads`
tables (keyed by OSM type+id, same dedup pattern as everywhere else) and drops the
staging schema.
