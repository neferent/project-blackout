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

   First boot will take a while: Valhalla downloads the extract and builds routing tiles
   (this can take several minutes to an hour depending on region size and machine). Watch
   `docker compose logs -f valhalla` for progress. The API runs its Postgres migrations
   automatically on startup.

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
