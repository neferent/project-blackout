# Project Blackout

A shared-world, location-based survival game played on the real map of Earth. The
power grid has failed and the world is dark. Pick a spot anywhere on the planet, settle
in, and start rebuilding: scavenge, craft, trade, and fortify a base, all on top of real
streets, buildings and infrastructure from OpenStreetMap.

The game is a proof of concept. The core loop of placing yourself in the world, moving
through it, and building a base is playable. Scavenging, trading and crafting are designed
but not built yet.

## Ideas behind it

- **The real world is the level.** Maps, buildings and roads come from OpenStreetMap, so
  your neighborhood is the game board. Walking routes are computed on real pedestrian
  paths.
- **Game time runs faster than real time.** One real minute is one game hour, and
  everyone walks at 5 km/h in game time. Crossing a city takes a few real minutes.
- **The server owns the clock.** Every action (traveling, building) has a start and end
  time stored on the server. Position, progress and each player's personal clock are
  computed when read, not advanced by client ticks. Nothing the client says about time is
  trusted.
- **The dark grid is dangerous.** The power grid is still intact but unsafe to connect to.
  Real transmission lines, towers, substations and plants are imported from OSM and drive
  a danger value that routing takes into account.
- **Bases are hex boards.** Each player gets a fixed 127-tile hex board stretched over the
  real H3 cell they chose, with the surrounding buildings, water, roads and landcover
  mapped onto it. Players place stations and items on it, and adjacent items boost each
  other (an anvil next to a forge makes crafting faster, for example).

## What works today

- Interactive map with a stylized flat 2D look (MapLibre GL JS over OpenFreeMap tiles)
- Building and place identification on click (Overpass point-in-polygon, Nominatim fallback)
- Choosing a starting location and creating an anonymous player
- Pedestrian routing and travel along real streets (self-hosted Valhalla), with smooth
  client animation that matches the server's authoritative position
- A power-grid danger layer backed by imported OSM data, with a disconnect action
- Base hex board: layout planning with live preview, synergy and hazard rules, tile
  designations (walkway/clear), and committing a layout as a timed action priced by the
  server

## Not built yet

Scavenging, real inventory and acquisition, trading, crafting, encounters, NPCs,
multiplayer interaction, user accounts (identity is anonymous for now), and deployment.

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md): the action system, personal clock, position
  resolution, and the extension points for new features
- [`docs/base-layout.md`](docs/base-layout.md): format of the base-layout rule config
- [`CLAUDE.md`](CLAUDE.md): project rules and conventions

## Data and attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
available under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/).
This repository contains no OSM data. Extracts, routing tiles and imported tables are
generated locally and kept out of version control.

- **Map tiles:** [OpenFreeMap](https://openfreemap.org/) (OpenMapTiles schema, built from
  OSM data), rendered with [MapLibre GL JS](https://maplibre.org/)
- **Place lookup:** [Nominatim](https://nominatim.org/), used under the
  [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
- **Building and infrastructure queries:** [Overpass API](https://overpass-api.de/)
- **Pedestrian routing:** [Valhalla](https://github.com/valhalla/valhalla), self-hosted
  and built from [Geofabrik](https://download.geofabrik.de/) OSM extracts
- **Power-grid import:** [osm2pgsql](https://osm2pgsql.org/), run in a container

Any database derived from OSM data (for example the imported power-grid and road tables)
remains subject to the ODbL if it is shared publicly.

## License

Proprietary. All rights reserved. See [`LICENSE`](LICENSE).

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
