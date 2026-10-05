# Base layout rule config

A base is a fixed 127-tile hex board (`BASE_HEX_RADIUS` = 6, axial `q`/`r` relative to the
center, flat-top). Players place item instances on tiles; the layout changes how many game
hours crafting costs. **All rules are data** in a `BaseLayoutConfig`
(`packages/shared/src/baseLayout/config.ts`, validated by zod). The seed config is
`packages/shared/src/baseLayout/seed.ts`; the server reads it through
`getBaseLayoutConfig()` (`apps/api/src/services/baseLayoutConfig.ts`), the web client imports
the seed directly. The same pure functions run on both sides (`engine.ts`, `draft.ts`):
the client for the free live preview, the server to validate and price a commit.

## Geometry

- Neighbors are indexed by facing 0–5. Facing 0 = +q, increasing clockwise on screen.
- Distances are hex distance (`hexDistance`).
- "Sides" of a station are relative to its facing: side `s` of a station facing `f` is
  absolute direction `(s + f) % 6`.

## Tile types

`indoor | yard | garden | paved | water | road`, stored per base in `base_tiles`.
Derived once at base creation from the client's board classification
(`tiles.ts`: building→indoor, landcover→garden, empty→yard, water→water, road→road).
`paved` has no classifier signal yet and only appears through the (not yet built) tile
conversion. Items list the tile types they accept in `slots`; roads and water are simply
never listed, so nothing can be placed on them.

## Top-level config

| Field | Default | Meaning |
|---|---|---|
| `version` | – | Config version |
| `bonusCap` | 0.25 | Cap on a station's summed *positive* bonus (0.25 = at most −25% time) |
| `maxPenalty` | 0.5 | Floor on a station's net bonus |
| `quality` | `{min: .5, max: 1.5}` | Quality 0–100 maps linearly onto a multiplier on positive bonuses |
| `unreachablePenalty` | 0.1 | Penalty when a station's front tile isn't reachable from the door |
| `rotateHours` | 0.1 | Game hours for rotating a placed item |
| `moveHoursPerUnit` | 0.05 | `k` in the move-cost formula |
| `items`, `synergies`, `hazards` | – | See below |

## Items

```ts
{
  id: "forge", name: "Forge", kind: "station" | "attachment" | "door",
  slots: ["indoor", "paved", "yard"],   // tile types it may sit on
  tags: ["workstation", "heat"],        // matched by "#tag" in rules
  weight: 8, size: 3,                   // used by move cost
  placeHours: 2,                        // game hours to place a new instance
  moveBaseHours: 0.5,                   // flat part of the move cost
  capabilities: ["heat", "smelting"],   // station: own capabilities
  grants: ["clamping"],                 // attachment: given to an adjacent station
  sides: [3],                           // attachment: allowed station-relative sides (omit = any)
  daylightBonus: 0.04,                  // bonus on an indoor tile bordering a non-indoor tile/edge
}
```

Items are *definitions*. Each player-owned item is an instance (`items` table: owner,
`definition_id`, `quality` 0–100) so quality differs and items can be traded.

Placement rules (`validateLayout`): the tile exists and its type is in `slots`; one item per
tile; an item is placed at most once; facing is 0–5; stations need an in-board, non-water,
unoccupied tile at their front; at most one door.

## Capabilities

`resolveCapabilities` returns, for a station: its own capabilities, those granted by
adjacent attachments (respecting `sides`; one attachment can serve two stations), and those
of every other station with the hex distance. A recipe requirement
`{ capability, range? }` is met (`requirementMet`) by self, an attached attachment, or —
only when `range` is given — a nearby station within that range.

## Synergies

```ts
{ id: "forge-anvil", label: "Forge + anvil",
  a: "forge", b: "anvil",          // item id, or "#tag"
  mode: "range", range: 2, falloff: 2,
  bonus: 0.10, farPenalty: 0.04,
  applies: "both" | "a" | "b" }    // which side(s) receive the effect
```

- `mode: "adjacent"`: binary; full bonus only at distance 1.
- `mode: "range"`: full bonus within `range`; over the next `falloff` tiles it tapers
  linearly to 0; beyond that `farPenalty` (a flat penalty) applies.
- Bonus is scaled by the mean quality factor of the two items. Penalties are not.
- Per rule and receiving station, only the best partner counts (no stacking).
- Only stations receive bonuses.

## Hazards

```ts
{ id: "forge-flammable", a: "forge", b: "#flammable", within: 1,
  penalty: 0.10, message: "Forge beside flammable storage" }
```

Triggers when the pair is within `within` tiles; shows a warning and a red link, and
applies `penalty` once per rule to each station involved.

## Efficiency

Per station: `positive` = sum of positive entries (synergy, daylight) → capped at
`bonusCap`; `penalty` = sum of negative entries (hazard, too-far, unreachable);
`bonus = max(−maxPenalty, cappedPositive − penalty)`; `timeMultiplier = 1 − bonus`.
Reachability: a BFS from the door tile over free non-water tiles; a station is reachable if
its front tile is in that set. With no door, every station is penalized and a warning shown.
`evaluateLayout` also returns the links drawn on the board and the warnings list.

## Cost of a layout change

`diffLayouts` + `layoutCostHours`: placing a new item costs `placeHours`; moving costs
`moveBaseHours + weight × size × hexDistance × moveHoursPerUnit`; a pure rotation costs
`rotateHours`; removal is free. `planLayoutCommit` validates, diffs and prices in one call.

## Commit flow

1. Client edits a local draft (plan mode; free) with `draft.ts` helpers.
2. `POST /base/layout/commit { baseVersion, placements }` sends the full target layout.
3. Server checks: player is at the base hex, nothing else is running, `baseVersion` matches,
   then `planLayoutCommit`. It creates a `layout` action whose duration is the cost.
4. While it runs the base is locked (the old layout stays committed; travel and disconnect
   are refused). The first read after `ends_at` swaps in the new placements and bumps
   `bases.layout_version` (`finalizeLayoutIfDone`).

## Not built (stubs / future)

- Tile conversion (road/paved → yard). `base_tiles.converted_from` exists for it.
- Item acquisition and trading. The starter kit is a stub (`itemGrantProvider.ts`).
- Saved/shared layouts: only the `SavedLayoutStub` interface exists.
- Crafting execution and the recipe list; recipes will consume `resolveCapabilities` and
  `timeMultiplier`.
