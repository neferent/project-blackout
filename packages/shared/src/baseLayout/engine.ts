import type { BaseLayoutConfig, ItemDef, TileType } from "./config.js";
import {
  directionBetween,
  hexDistance,
  hexKey,
  hexNeighbor,
  hexNeighbors,
  normalizeFacing,
  type Axial,
} from "./hex.js";

export interface LayoutTile extends Axial {
  tileType: TileType;
}
export interface LayoutPlacement extends Axial {
  itemId: string;
  facing: number;
}
export interface LayoutItemInstance {
  definitionId: string;
  /** 0..100 */
  quality: number;
}
export interface LayoutInput {
  tiles: LayoutTile[];
  placements: LayoutPlacement[];
  items: Record<string, LayoutItemInstance>;
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

const defIndexCache = new WeakMap<BaseLayoutConfig, Map<string, ItemDef>>();

export function getItemDef(config: BaseLayoutConfig, definitionId: string): ItemDef | undefined {
  let index = defIndexCache.get(config);
  if (!index) {
    index = new Map(config.items.map((d) => [d.id, d]));
    defIndexCache.set(config, index);
  }
  return index.get(definitionId);
}

/** Matcher is an item definition id, or "#tag". */
export function matchesItem(matcher: string, def: ItemDef): boolean {
  return matcher.startsWith("#") ? def.tags.includes(matcher.slice(1)) : def.id === matcher;
}

export function qualityFactor(config: BaseLayoutConfig, quality: number): number {
  const t = Math.min(1, Math.max(0, quality / 100));
  return config.quality.min + (config.quality.max - config.quality.min) * t;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface Resolved {
  placement: LayoutPlacement;
  def: ItemDef;
  instance: LayoutItemInstance;
}

interface Context {
  config: BaseLayoutConfig;
  tileByKey: Map<string, LayoutTile>;
  resolved: Resolved[];
  resolvedByItem: Map<string, Resolved>;
  /** Tile key -> placement occupying it. */
  occupied: Map<string, Resolved>;
}

function buildContext(config: BaseLayoutConfig, input: LayoutInput): Context {
  const tileByKey = new Map(input.tiles.map((t) => [hexKey(t.q, t.r), t]));
  const resolved: Resolved[] = [];
  for (const placement of input.placements) {
    const instance = input.items[placement.itemId];
    const def = instance && getItemDef(config, instance.definitionId);
    if (instance && def) resolved.push({ placement, def, instance });
  }
  return {
    config,
    tileByKey,
    resolved,
    resolvedByItem: new Map(resolved.map((r) => [r.placement.itemId, r])),
    occupied: new Map(resolved.map((r) => [hexKey(r.placement.q, r.placement.r), r])),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type LayoutErrorCode =
  | "unknown-item"
  | "unknown-tile"
  | "slot-mismatch"
  | "tile-occupied"
  | "duplicate-item"
  | "bad-facing"
  | "front-blocked"
  | "multiple-doors";

export interface LayoutError {
  code: LayoutErrorCode;
  itemId?: string;
  message: string;
}

/** Hard rules the server enforces on commit. Pure; also usable for client-side feedback. */
export function validateLayout(config: BaseLayoutConfig, input: LayoutInput): LayoutError[] {
  const errors: LayoutError[] = [];
  const ctx = buildContext(config, input);
  const seenItems = new Set<string>();
  const seenTiles = new Set<string>();
  let doors = 0;

  for (const placement of input.placements) {
    const instance = input.items[placement.itemId];
    const def = instance && getItemDef(config, instance.definitionId);
    if (!def) {
      errors.push({ code: "unknown-item", itemId: placement.itemId, message: "Unknown item" });
      continue;
    }
    if (seenItems.has(placement.itemId)) {
      errors.push({ code: "duplicate-item", itemId: placement.itemId, message: `${def.name} is placed twice` });
    }
    seenItems.add(placement.itemId);

    if (!Number.isInteger(placement.facing) || placement.facing < 0 || placement.facing > 5) {
      errors.push({ code: "bad-facing", itemId: placement.itemId, message: "Facing must be 0–5" });
    }

    const key = hexKey(placement.q, placement.r);
    const tile = ctx.tileByKey.get(key);
    if (!tile) {
      errors.push({ code: "unknown-tile", itemId: placement.itemId, message: `${def.name} is off the board` });
      continue;
    }
    if (seenTiles.has(key)) {
      errors.push({ code: "tile-occupied", itemId: placement.itemId, message: `Two items on one tile (${key})` });
    }
    seenTiles.add(key);

    if (!def.slots.includes(tile.tileType)) {
      errors.push({
        code: "slot-mismatch",
        itemId: placement.itemId,
        message: `${def.name} can't go on a ${tile.tileType} tile`,
      });
    }

    if (def.kind === "door") doors++;

    if (def.kind === "station") {
      const front = hexNeighbor(placement, placement.facing);
      const frontKey = hexKey(front.q, front.r);
      const frontTile = ctx.tileByKey.get(frontKey);
      if (!frontTile || frontTile.tileType === "water" || input.placements.some((p) => hexKey(p.q, p.r) === frontKey)) {
        errors.push({ code: "front-blocked", itemId: placement.itemId, message: `${def.name} needs an open tile in front` });
      }
    }
  }
  if (doors > 1) errors.push({ code: "multiple-doors", message: "A base can only have one door" });
  return errors;
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface CapabilityGrant {
  capability: string;
  source: "self" | "attachment" | "nearby";
  fromItemId: string;
  /** Hex distance from the station (0 for self). */
  distance: number;
}

export interface CapabilityRequirement {
  capability: string;
  /** Omitted = only the station itself or an attached attachment counts. */
  range?: number;
}

/**
 * Every capability a station can draw on: its own, those of attachments on a permitted side,
 * and those of other stations (at any distance — filter with `requirementMet`).
 */
export function resolveCapabilities(config: BaseLayoutConfig, input: LayoutInput, stationItemId: string): CapabilityGrant[] {
  const ctx = buildContext(config, input);
  const station = ctx.resolvedByItem.get(stationItemId);
  if (!station || station.def.kind !== "station") return [];
  const grants: CapabilityGrant[] = [];

  for (const capability of station.def.capabilities) {
    grants.push({ capability, source: "self", fromItemId: stationItemId, distance: 0 });
  }
  for (const other of ctx.resolved) {
    if (other === station) continue;
    const distance = hexDistance(station.placement, other.placement);
    if (other.def.kind === "attachment") {
      if (distance !== 1) continue;
      const side = directionBetween(station.placement, other.placement);
      if (side === null) continue;
      const relative = normalizeFacing(side - station.placement.facing);
      if (other.def.sides && !other.def.sides.includes(relative)) continue;
      for (const capability of other.def.grants) {
        grants.push({ capability, source: "attachment", fromItemId: other.placement.itemId, distance });
      }
    } else if (other.def.kind === "station") {
      for (const capability of other.def.capabilities) {
        grants.push({ capability, source: "nearby", fromItemId: other.placement.itemId, distance });
      }
    }
  }
  return grants;
}

export function requirementMet(grants: CapabilityGrant[], requirement: CapabilityRequirement): boolean {
  return grants.some(
    (g) =>
      g.capability === requirement.capability &&
      (g.source !== "nearby" || (requirement.range !== undefined && g.distance <= requirement.range)),
  );
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface BonusEntry {
  source: "synergy" | "daylight" | "hazard" | "distance" | "unreachable";
  ruleId?: string;
  otherItemId?: string;
  /** Signed fraction of time saved (positive) or lost (negative). */
  value: number;
  label: string;
}

export interface StationEfficiency {
  itemId: string;
  positive: number;
  cappedPositive: number;
  penalty: number;
  /** Final net fraction of time saved, e.g. 0.12 = -12% game hours. */
  bonus: number;
  /** Multiply a recipe's base game hours by this. */
  timeMultiplier: number;
  reachable: boolean;
  breakdown: BonusEntry[];
}

export interface LayoutLink {
  kind: "synergy" | "hazard" | "distance";
  ruleId: string;
  fromItemId: string;
  toItemId: string;
  distance: number;
  value: number;
  label: string;
}

export type LayoutWarningCode = "hazard" | "no-door" | "unreachable" | "unattached";
export interface LayoutWarning {
  code: LayoutWarningCode;
  itemIds: string[];
  message: string;
}

export interface LayoutEvaluation {
  stations: Record<string, StationEfficiency>;
  links: LayoutLink[];
  warnings: LayoutWarning[];
}

function rangeFactor(rule: { mode: string; range: number; falloff: number }, distance: number): number {
  if (rule.mode === "adjacent") return distance === 1 ? 1 : 0;
  if (distance <= rule.range) return 1;
  if (rule.falloff > 0 && distance <= rule.range + rule.falloff) {
    return 1 - (distance - rule.range) / (rule.falloff + 1);
  }
  return 0;
}

/** Tiles reachable on foot from the door through free, non-water tiles (door tile included). */
function reachableFromDoor(ctx: Context): Set<string> {
  const door = ctx.resolved.find((r) => r.def.kind === "door");
  const reached = new Set<string>();
  if (!door) return reached;
  const startKey = hexKey(door.placement.q, door.placement.r);
  reached.add(startKey);
  const queue: Axial[] = [door.placement];
  while (queue.length) {
    const at = queue.shift()!;
    for (const n of hexNeighbors(at)) {
      const key = hexKey(n.q, n.r);
      const tile = ctx.tileByKey.get(key);
      if (!tile || tile.tileType === "water" || ctx.occupied.has(key) || reached.has(key)) continue;
      reached.add(key);
      queue.push(n);
    }
  }
  return reached;
}

function isDaylit(ctx: Context, at: Axial): boolean {
  const tile = ctx.tileByKey.get(hexKey(at.q, at.r));
  if (tile?.tileType !== "indoor") return false;
  return hexNeighbors(at).some((n) => ctx.tileByKey.get(hexKey(n.q, n.r))?.tileType !== "indoor");
}

/** Efficiency, links and warnings for a layout. Pure; same code runs on client and server. */
export function evaluateLayout(config: BaseLayoutConfig, input: LayoutInput): LayoutEvaluation {
  const ctx = buildContext(config, input);
  const stations = ctx.resolved.filter((r) => r.def.kind === "station");
  const links: LayoutLink[] = [];
  const warnings: LayoutWarning[] = [];
  const entries = new Map<string, BonusEntry[]>(stations.map((s) => [s.placement.itemId, []]));

  // Synergies: per (rule, receiving station) only the best partner counts.
  for (const rule of config.synergies) {
    const best = new Map<string, { entry: BonusEntry; link: LayoutLink }>();
    const consider = (target: Resolved, partner: Resolved, distance: number) => {
      if (target.def.kind !== "station") return;
      const factor = rangeFactor(rule, distance);
      const qf = (qualityFactor(config, target.instance.quality) + qualityFactor(config, partner.instance.quality)) / 2;
      let value = 0;
      let source: BonusEntry["source"] = "synergy";
      if (factor > 0) value = rule.bonus * factor * qf;
      else if (rule.mode === "range" && rule.farPenalty > 0 && distance > rule.range + rule.falloff) {
        value = -rule.farPenalty;
        source = "distance";
      }
      if (value === 0) return;
      const id = target.placement.itemId;
      const prev = best.get(id);
      if (prev && prev.entry.value >= value) return;
      const label = `${rule.label}${value < 0 ? " (too far)" : ""}`;
      best.set(id, {
        entry: { source, ruleId: rule.id, otherItemId: partner.placement.itemId, value, label },
        link: {
          kind: source === "distance" ? "distance" : "synergy",
          ruleId: rule.id,
          fromItemId: partner.placement.itemId,
          toItemId: id,
          distance,
          value,
          label,
        },
      });
    };
    for (let i = 0; i < ctx.resolved.length; i++) {
      for (let j = i + 1; j < ctx.resolved.length; j++) {
        const x = ctx.resolved[i];
        const y = ctx.resolved[j];
        const distance = hexDistance(x.placement, y.placement);
        const [a, b] = matchesItem(rule.a, x.def) && matchesItem(rule.b, y.def)
          ? [x, y]
          : matchesItem(rule.a, y.def) && matchesItem(rule.b, x.def)
            ? [y, x]
            : [null, null];
        if (!a || !b) continue;
        if (rule.applies !== "b") consider(a, b, distance);
        if (rule.applies !== "a") consider(b, a, distance);
      }
    }
    for (const [id, { entry, link }] of best) {
      entries.get(id)!.push(entry);
      links.push(link);
    }
  }

  // Hazards: worst penalty per (rule, station); one warning per offending pair.
  for (const rule of config.hazards) {
    const worst = new Set<string>();
    for (let i = 0; i < ctx.resolved.length; i++) {
      for (let j = i + 1; j < ctx.resolved.length; j++) {
        const x = ctx.resolved[i];
        const y = ctx.resolved[j];
        const distance = hexDistance(x.placement, y.placement);
        if (distance > rule.within) continue;
        const hit =
          (matchesItem(rule.a, x.def) && matchesItem(rule.b, y.def)) ||
          (matchesItem(rule.a, y.def) && matchesItem(rule.b, x.def));
        if (!hit) continue;
        warnings.push({ code: "hazard", itemIds: [x.placement.itemId, y.placement.itemId], message: rule.message });
        links.push({
          kind: "hazard",
          ruleId: rule.id,
          fromItemId: x.placement.itemId,
          toItemId: y.placement.itemId,
          distance,
          value: -rule.penalty,
          label: rule.message,
        });
        for (const target of [x, y]) {
          const id = target.placement.itemId;
          if (target.def.kind !== "station" || worst.has(id)) continue;
          worst.add(id);
          entries.get(id)!.push({
            source: "hazard",
            ruleId: rule.id,
            otherItemId: id === x.placement.itemId ? y.placement.itemId : x.placement.itemId,
            value: -rule.penalty,
            label: rule.message,
          });
        }
      }
    }
  }

  // Daylight and reachability.
  const reached = reachableFromDoor(ctx);
  const hasDoor = ctx.resolved.some((r) => r.def.kind === "door");
  if (!hasDoor && stations.length > 0) {
    warnings.push({
      code: "no-door",
      itemIds: stations.map((s) => s.placement.itemId),
      message: "No door placed — stations can't be reached",
    });
  }
  const result: Record<string, StationEfficiency> = {};
  for (const s of stations) {
    const id = s.placement.itemId;
    const list = entries.get(id)!;
    if (s.def.daylightBonus && isDaylit(ctx, s.placement)) {
      list.push({
        source: "daylight",
        value: s.def.daylightBonus * qualityFactor(config, s.instance.quality),
        label: "Daylight",
      });
    }
    const front = hexNeighbor(s.placement, s.placement.facing);
    const reachable = reached.has(hexKey(front.q, front.r));
    if (!reachable) {
      list.push({ source: "unreachable", value: -config.unreachablePenalty, label: "Can't reach this station" });
      if (hasDoor) {
        warnings.push({ code: "unreachable", itemIds: [id], message: `${s.def.name} can't be reached from the door` });
      }
    }
    const positive = list.filter((e) => e.value > 0).reduce((sum, e) => sum + e.value, 0);
    const penalty = -list.filter((e) => e.value < 0).reduce((sum, e) => sum + e.value, 0);
    const cappedPositive = Math.min(positive, config.bonusCap);
    const bonus = Math.max(-config.maxPenalty, cappedPositive - penalty);
    result[id] = { itemId: id, positive, cappedPositive, penalty, bonus, timeMultiplier: 1 - bonus, reachable, breakdown: list };
  }

  // Attachments that don't touch any station they could serve.
  for (const a of ctx.resolved.filter((r) => r.def.kind === "attachment")) {
    const served = stations.some((s) => {
      if (hexDistance(s.placement, a.placement) !== 1) return false;
      const side = directionBetween(s.placement, a.placement);
      return side !== null && (!a.def.sides || a.def.sides.includes(normalizeFacing(side - s.placement.facing)));
    });
    if (!served) {
      warnings.push({ code: "unattached", itemIds: [a.placement.itemId], message: `${a.def.name} isn't attached to a station` });
    }
  }

  return { stations: result, links, warnings };
}

// ---------------------------------------------------------------------------
// Diff and cost
// ---------------------------------------------------------------------------

export interface LayoutDiffEntry {
  itemId: string;
  from?: LayoutPlacement;
  to?: LayoutPlacement;
}
export interface LayoutDiff {
  added: LayoutDiffEntry[];
  removed: LayoutDiffEntry[];
  moved: LayoutDiffEntry[];
  rotated: LayoutDiffEntry[];
}

export function diffLayouts(before: LayoutPlacement[], after: LayoutPlacement[]): LayoutDiff {
  const beforeBy = new Map(before.map((p) => [p.itemId, p]));
  const afterBy = new Map(after.map((p) => [p.itemId, p]));
  const diff: LayoutDiff = { added: [], removed: [], moved: [], rotated: [] };
  for (const [itemId, to] of afterBy) {
    const from = beforeBy.get(itemId);
    if (!from) diff.added.push({ itemId, to });
    else if (from.q !== to.q || from.r !== to.r) diff.moved.push({ itemId, from, to });
    else if (from.facing !== to.facing) diff.rotated.push({ itemId, from, to });
  }
  for (const [itemId, from] of beforeBy) {
    if (!afterBy.has(itemId)) diff.removed.push({ itemId, from });
  }
  return diff;
}

export interface LayoutCost {
  hours: number;
  perItem: Record<string, number>;
}

/**
 * Game hours to carry out a diff. Placing from inventory costs `placeHours`; moving costs
 * base + weight * size * distance * k; a pure rotation costs `rotateHours`; removal is free.
 */
export function layoutCostHours(
  config: BaseLayoutConfig,
  diff: LayoutDiff,
  items: Record<string, LayoutItemInstance>,
): LayoutCost {
  const perItem: Record<string, number> = {};
  const defOf = (itemId: string) => {
    const instance = items[itemId];
    return instance && getItemDef(config, instance.definitionId);
  };
  for (const e of diff.added) perItem[e.itemId] = defOf(e.itemId)?.placeHours ?? 0;
  for (const e of diff.moved) {
    const def = defOf(e.itemId);
    perItem[e.itemId] = def
      ? def.moveBaseHours + def.weight * def.size * hexDistance(e.from!, e.to!) * config.moveHoursPerUnit
      : 0;
  }
  for (const e of diff.rotated) perItem[e.itemId] = config.rotateHours;
  const hours = Object.values(perItem).reduce((a, b) => a + b, 0);
  return { hours, perItem };
}

// ---------------------------------------------------------------------------
// Commit planning
// ---------------------------------------------------------------------------

export type LayoutCommitPlan =
  | { ok: true; diff: LayoutDiff; cost: LayoutCost; gameSeconds: number }
  | { ok: false; reason: "invalid"; errors: LayoutError[] }
  | { ok: false; reason: "no-changes" };

/** Everything the server decides about a commit, as one pure function (validate, diff, price). */
export function planLayoutCommit(
  config: BaseLayoutConfig,
  args: { tiles: LayoutTile[]; items: Record<string, LayoutItemInstance>; current: LayoutPlacement[]; requested: LayoutPlacement[] },
): LayoutCommitPlan {
  const errors = validateLayout(config, { tiles: args.tiles, items: args.items, placements: args.requested });
  if (errors.length) return { ok: false, reason: "invalid", errors };
  const diff = diffLayouts(args.current, args.requested);
  if (!diff.added.length && !diff.removed.length && !diff.moved.length && !diff.rotated.length) {
    return { ok: false, reason: "no-changes" };
  }
  const cost = layoutCostHours(config, diff, args.items);
  return { ok: true, diff, cost, gameSeconds: Math.round(cost.hours * 3600) };
}
