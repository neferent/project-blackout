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

## Identity

`apps/api/src/identity/anonPlayer.ts` (server) and `apps/web/src/identity/anonPlayerId.ts`
(client) are the only places that know about the anonymous-id-in-a-header scheme. Swapping
in Better Auth means replacing these two modules and the `requireAnonKey` middleware; no
route handler needs to change since they only ever see a resolved player.

## Internal IDs

`players.id` and `actions.id` are server-generated UUIDs. Nothing in the schema or API
references an OSM node/way ID as a primary or foreign key — OSM data only ever supplies
coordinates (via Nominatim search or a map click) that get stored as plain `lat`/`lng`.
