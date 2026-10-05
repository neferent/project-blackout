# Architecture

This POC is scoped to map loading, start placement, and travel — but the pieces below
exist specifically so scavenging, crafting, danger, encounters, and buildings plug in
without reworking what's already here.

## Action system

Everything a player *does* over time is an `actions` row: `id, player_id, kind, starts_at,
ends_at, data (jsonb)`. Travel is the only kind implemented, but nothing about the table,
the routes, or the personal clock is travel-specific.

Each kind registers a handler (`apps/api/src/actions/registry.ts`):

```ts
interface ActionHandler<TData> {
  kind: ActionKind;
  gameDurationSeconds(data: TData): number;
}
```

`apps/api/src/actions/travel.ts` is the only implementation today. Adding scavenging or
crafting means: add the kind to `ActionKind` in `packages/shared/src/schemas.ts`, add a
zod schema for its `data` shape, write a handler that reports how much game time it costs,
and add whatever route creates it. The personal clock and read-time resolution don't change.

## Personal clock

A player's clock is never stored — it's `computePersonalClock` (`apps/api/src/actions/
personalClock.ts`) folding over their action history: start from `createdAt`, and for each
action add `gameDurationSeconds(data) * tripProgress(startsAt, endsAt, now)`. An in-progress
action contributes partial credit; a finished one contributes its full duration. This means
the server never trusts a client-supplied clock, and adding a new action kind automatically
flows into the clock as long as it registers a handler.

## Position on read

A player's current position is resolved, not stored as a moving value:

- No action, or the latest travel action has ended → their last resting `position` column.
- An in-progress travel action → interpolated along the route's coordinates using
  `interpolateAlongLine` (`packages/shared/src/routeInterpolation.ts`), a plain
  cumulative-haversine-distance function — pure, unit-tested, and shared between the
  server (authoritative) and the client (smooth 60fps animation between server syncs).
- The first read after a trip's `ends_at` has passed lazily writes the destination back to
  `players.position`/`current_h3_cell` — "finalizing" it — so later reads don't need to
  replay history forever. This is `resolvePlayerState` in `apps/api/src/state/playerState.ts`.

Reloading mid-trip just calls `GET /players/me` again, which resolves from `starts_at`/
`ends_at`, not from anything the client remembered.

## Danger layer stub

`apps/api/src/services/dangerProvider.ts` defines `DangerProvider.dangerForCell(h3Cell):
Promise<number>`, always returning 0 today. `POST /routes/preview` and `POST /actions/travel`
both go through it before calling Valhalla. When phasing/blight/entities exist, a real
implementation reads danger per H3 cell (resolution 9, matching `players.current_h3_cell`)
and the routing call can turn that into Valhalla `costing_options` (avoid zones / edge
costs) without changing the route/travel call sites.

## Encounter hook

`apps/api/src/services/encounterPlanner.ts` defines `EncounterPlanner.planEncounters(route):
Promise<EncounterPoint[]>`, called once when a trip is created and always empty today. Its
result is stored in the travel action's `data.encounters`. When encounters exist, travel
resolution (`resolvePlayerState`) is the place to check whether the current trip fraction
has crossed an encounter point and should treat the trip as paused there instead of resolving
straight through to the destination.

## Map layer registry

`apps/web/src/map/layerRegistry.ts` defines fixed z-order slots: `basemap`,
`overlay-under-buildings`, `buildings`, `overlay-over-buildings`, `markers`, `labels`,
`player`. The base style (`apps/web/src/map/style.ts`) tags each of its static layers with
its slot via `metadata.slot`. `registerMapLayer(map, slot, layer)` inserts a new layer
immediately before the first existing layer that belongs to a later slot, so any feature
can call it without knowing what else has registered. The POC only fills `basemap`
(background/water/roads/etc., in the static style), `buildings` (static), `labels` (static
place labels), and `player` (a dynamically added circle layer, `apps/web/src/features/
travel/PlayerMarkerLayer.ts`). Scavenging/building-classification work adds layers into
`overlay-under-buildings`/`overlay-over-buildings`/`markers` the same way.

## Base hex grid

`apps/web/src/features/placement/hexGrid.ts` turns a player's chosen H3 interaction cell
into a fixed-size **hex-of-hexes board** — a flat-top hexagon made of `BASE_HEX_RADIUS`
rings of smaller hex cells (127 cells at radius 6), in axial coordinates. This is the
foundation for base building: eventually players place crafting stations/garden plots
into these cells, and adjacent cells bonus each other (e.g. anvil next to forge = faster
crafts). Hex cells were chosen specifically for that — every cell has exactly 6
equidistant neighbors, so "adjacent" never needs the orthogonal-vs-diagonal distinction a
square grid would force.

Key design point: **every base is the same board, regardless of the real hex's shape.**
Real H3 cells vary in size/shape (more at some latitudes than others), but gameplay
(capacity, costs, UI) shouldn't wobble per player based on where they happened to click.
So `classifyHexGrid` computes the abstract hex-of-hexes layout once (at unit size), finds
its bounding box, then linearly maps that onto the real hex's actual bounding box in
meters — independently per axis. The real OSM features (building/water/road/landcover,
read live via MapLibre's `queryRenderedFeatures`) get stretched or squeezed to exactly
fill the fixed board. This is a deliberate trade: distort the ground truth, not the board
shape or cell count.

`classifyHexGrid` reads from already-rendered vector tiles, which are zoom-simplified —
fine for showing the player what their base will roughly look like while picking a hex
(`StartPicker.vue`), not full-fidelity ground truth. That preview-grade quality is a
property of the *data source* (simplified tiles), not of client vs. server execution, so
Phase 2 made a deliberate call: rather than standing up a parallel server-side Overpass
pipeline (the `findBuildingsInZone` pattern used for decay buildings) to re-derive the
same approximate answer, the server trusts the client's computed `HexGridResult` outright
and persists it on create-player (`POST /players`, `hexGridResultSchema` in
`packages/shared/src/schemas.ts`). The one thing the server does re-check is the
minimum-building-cells rule (`MIN_BASE_BUILDING_CELLS`), since that's a cheap, meaningful
guard against a tampered or buggy client — never trust a client claim where checking it
server-side is nearly free, even if the underlying data isn't authoritative either way.

Persisted shape (simpler than originally proposed — no `base_hexes`, no multi-hex/
multi-base support, since neither is designed yet):

```
bases (id, player_id unique, hex_cell, radius, grid_data jsonb, created_at)
```

One base per player for the POC (`player_id` is unique) — `playerState.ts` joins it in as
`baseGrid` on every `resolvePlayerState` call; players created before this existed simply
have `baseGrid: null`. A base can eventually own multiple hexes (expansion), and a player
can eventually own multiple bases — the 2nd/3rd base or additional hex has a steep cost,
not yet designed; that's when `base_hexes` would actually earn its keep. If the preview
grid ever proves too distorted to be fair gameplay ground truth, authoritative OSM
re-derivation is the fallback plan, not a given.

## Base layout

Placement and the efficiency bonuses are built; see `docs/base-layout.md` for the rule
config format. In short:

- **Rules are data in `packages/shared/src/baseLayout/`** (item definitions, synergies,
  hazards, cap, cost constants). Pure functions (`validateLayout`, `evaluateLayout`,
  `planLayoutCommit`, `draft.ts`) run on both client (free plan-mode preview) and server
  (validation, pricing). Don't copy rule logic into either app.
- **Tables:** `base_tiles` (typed tiles, authoritative for rules; `bases.grid_data` is only
  the creation-time preview), `items` (tradable instances with quality; `definition_id` is
  a config key, not an FK), `placements`. `bases.layout_version` and a cached
  `layout_efficiency` are invalidated when a layout commit finalizes.
- **Commit is an action.** `POST /base/layout/commit` creates a `layout` action
  (`apps/api/src/actions/layout.ts`) whose duration is the server-computed diff cost. The
  new placements apply lazily on the first read after `ends_at` (`finalizeLayoutIfDone`),
  the same read-time pattern as finishing a trip. While it runs the base is locked and
  travel/disconnect are refused.
- **Stubs:** `itemGrantProvider.ts` grants a starter kit (replace with real acquisition);
  `getBaseLayoutConfig()` returns the seed (swap for a stored config later). Tile
  conversion is not built.

## Identity

`apps/api/src/identity/anonPlayer.ts` (server) and `apps/web/src/identity/anonPlayerId.ts`
(client) are the only places that know about the anonymous-id-in-a-header scheme. Swapping
in Better Auth means replacing these two modules and the `requireAnonKey` middleware; no
route handler needs to change since they only ever see a resolved player.

## Internal IDs

`players.id` and `actions.id` are server-generated UUIDs. Nothing in the schema or API
references an OSM node/way ID as a primary or foreign key — OSM data only ever supplies
coordinates (via Nominatim search or a map click) that get stored as plain `lat`/`lng`.
