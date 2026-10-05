import { describe, expect, it } from "vitest";
import { hexOfRadius } from "./testUtil.js";
import { SEED_BASE_LAYOUT_CONFIG as config } from "./seed.js";
import {
  diffLayouts,
  evaluateLayout,
  layoutCostHours,
  planLayoutCommit,
  requirementMet,
  resolveCapabilities,
  validateLayout,
  type LayoutInput,
  type LayoutPlacement,
} from "./engine.js";
import { baseLayoutConfigSchema } from "./config.js";
import { hexDistance, hexNeighbor, directionBetween } from "./hex.js";

const tiles = hexOfRadius(6, "indoor");

function layout(
  placed: { id: string; def: string; q: number; r: number; facing?: number; quality?: number }[],
  customTiles = tiles,
): LayoutInput {
  return {
    tiles: customTiles,
    placements: placed.map((p) => ({ itemId: p.id, q: p.q, r: p.r, facing: p.facing ?? 0 })),
    items: Object.fromEntries(placed.map((p) => [p.id, { definitionId: p.def, quality: p.quality ?? 50 }])),
  };
}

// Door at (0,6)-ish edge with an open corridor, stations facing a free tile.
const door = { id: "d", def: "door", q: -3, r: 0, facing: 0 };

describe("hex helpers", () => {
  it("measures distance and direction", () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: -1 })).toBe(2);
    expect(hexNeighbor({ q: 0, r: 0 }, 0)).toEqual({ q: 1, r: 0 });
    expect(directionBetween({ q: 0, r: 0 }, { q: 0, r: 1 })).toBe(1);
    expect(directionBetween({ q: 0, r: 0 }, { q: 2, r: 0 })).toBeNull();
  });
});

describe("config", () => {
  it("parses the seed with the documented shape", () => {
    expect(config.items.filter((i) => i.kind === "station")).toHaveLength(6);
    expect(config.items.filter((i) => i.kind === "attachment")).toHaveLength(6);
    expect(baseLayoutConfigSchema.safeParse({ version: 1, items: [] }).success).toBe(false);
  });
});

describe("validateLayout", () => {
  it("accepts a legal layout", () => {
    const l = layout([door, { id: "f", def: "forge", q: 0, r: 0 }]);
    expect(validateLayout(config, l)).toEqual([]);
  });

  it("rejects wrong slot types, roads, and water", () => {
    const t = hexOfRadius(6, "indoor").map((x) =>
      x.q === 1 && x.r === 0 ? { ...x, tileType: "road" as const } : x.q === 0 && x.r === 1 ? { ...x, tileType: "yard" as const } : x,
    );
    const l = layout(
      [
        { id: "a", def: "anvil", q: 1, r: 0, facing: 1 },
        { id: "s", def: "still", q: 0, r: 1, facing: 3 },
      ],
      t,
    );
    const codes = validateLayout(config, l).map((e) => e.code);
    expect(codes).toContain("slot-mismatch");
    expect(codes.filter((c) => c === "slot-mismatch")).toHaveLength(2);
  });

  it("requires an open front tile", () => {
    const l = layout([
      { id: "f", def: "forge", q: 0, r: 0, facing: 0 },
      { id: "a", def: "anvil", q: 1, r: 0, facing: 3 },
    ]);
    const errs = validateLayout(config, l);
    expect(errs.filter((e) => e.code === "front-blocked").map((e) => e.itemId).sort()).toEqual(["a", "f"]);
  });

  it("rejects duplicates, off-board, two doors, bad facing", () => {
    const l = layout([
      { id: "d1", def: "door", q: 0, r: 0 },
      { id: "d2", def: "door", q: 0, r: 0 },
      { id: "x", def: "lamp", q: 99, r: 0 },
      { id: "y", def: "lamp", q: 2, r: 0, facing: 7 },
    ]);
    const codes = validateLayout(config, l).map((e) => e.code);
    expect(codes).toEqual(expect.arrayContaining(["tile-occupied", "unknown-tile", "multiple-doors", "bad-facing"]));
  });
});

describe("evaluateLayout", () => {
  it("gives a forge/anvil bonus that falls off with distance and turns into a penalty far away", () => {
    const eff = (anvilQ: number) =>
      evaluateLayout(
        config,
        layout([door, { id: "f", def: "forge", q: 0, r: 0, facing: 1 }, { id: "a", def: "anvil", q: anvilQ, r: 0, facing: 1 }]),
      );
    const near = eff(2).stations.f.breakdown.find((b) => b.ruleId === "forge-anvil")!;
    const mid = eff(3).stations.f.breakdown.find((b) => b.ruleId === "forge-anvil")!;
    const far = eff(6).stations.f.breakdown.find((b) => b.ruleId === "forge-anvil")!;
    expect(near.value).toBeCloseTo(0.1, 5);
    expect(mid.value).toBeGreaterThan(0);
    expect(mid.value).toBeLessThan(near.value);
    expect(far.value).toBeCloseTo(-0.04, 5);
    expect(far.source).toBe("distance");
  });

  it("scales bonuses by quality", () => {
    const at = (quality: number) =>
      evaluateLayout(
        config,
        layout([door, { id: "f", def: "forge", q: 0, r: 0, facing: 1, quality }, { id: "a", def: "anvil", q: 2, r: 0, facing: 1, quality }]),
      ).stations.f.breakdown.find((b) => b.ruleId === "forge-anvil")!.value;
    expect(at(100)).toBeGreaterThan(at(50));
    expect(at(50)).toBeGreaterThan(at(0));
  });

  it("adjacent rules are binary and attachments must be adjacent", () => {
    const adj = evaluateLayout(
      config,
      layout([door, { id: "w", def: "workbench", q: 0, r: 0, facing: 1 }, { id: "v", def: "vice", q: 0, r: -1 }]),
    );
    const apart = evaluateLayout(
      config,
      layout([door, { id: "w", def: "workbench", q: 0, r: 0, facing: 1 }, { id: "v", def: "vice", q: 0, r: -2 }]),
    );
    expect(adj.stations.w.breakdown.some((b) => b.ruleId === "bench-vice")).toBe(true);
    expect(apart.stations.w.breakdown.some((b) => b.ruleId === "bench-vice")).toBe(false);
    expect(apart.warnings.some((w) => w.code === "unattached")).toBe(true);
  });

  it("caps the positive total but not penalties", () => {
    const l = layout([
      door,
      { id: "w", def: "workbench", q: 0, r: 0, facing: 1, quality: 100 },
      { id: "r", def: "tool_rack", q: 0, r: -1 },
      { id: "v", def: "vice", q: 1, r: -1 },
      { id: "s", def: "storage_shelf", q: -1, r: 0 },
    ]);
    const tight = { ...config, bonusCap: 0.1 };
    const w = evaluateLayout(tight, l).stations.w;
    expect(w.positive).toBeGreaterThan(tight.bonusCap);
    expect(w.cappedPositive).toBe(tight.bonusCap);
    expect(w.bonus).toBeCloseTo(tight.bonusCap - w.penalty, 5);
  });

  it("flags hazards and applies penalties", () => {
    const e = evaluateLayout(
      config,
      layout([door, { id: "f", def: "forge", q: 0, r: 0, facing: 1 }, { id: "s", def: "storage_shelf", q: 1, r: 0, facing: 1 }]),
    );
    expect(e.warnings.some((w) => w.code === "hazard" && w.itemIds.includes("f"))).toBe(true);
    expect(e.stations.f.breakdown.some((b) => b.source === "hazard" && b.value === -0.1)).toBe(true);
  });

  it("gives daylight only on indoor edge tiles", () => {
    const t = hexOfRadius(6, "indoor").map((x) => (hexDistance({ q: 0, r: 0 }, x) > 3 ? { ...x, tileType: "yard" as const } : x));
    const at = (q: number, r: number) =>
      evaluateLayout(config, layout([{ id: "d", def: "door", q: 0, r: 0 }, { id: "w", def: "workbench", q, r, facing: 3 }], t)).stations.w.breakdown.some(
        (b) => b.source === "daylight",
      );
    expect(at(3, 0)).toBe(true);
    expect(at(1, 0)).toBe(false);
  });

  it("penalizes unreachable stations and everything when there is no door", () => {
    const walled = layout([door, { id: "f", def: "forge", q: 0, r: 0, facing: 0 }]);
    // Door isolated by a ring of items around the forge's front tile (1,0).
    const ring = [
      { q: 2, r: -1 }, { q: 2, r: 0 }, { q: 1, r: 1 }, { q: 0, r: 1 }, { q: 1, r: -1 },
    ].map((p, i) => ({ id: `l${i}`, def: "lamp", ...p }));
    const blocked = evaluateLayout(config, layout([door, { id: "f", def: "forge", q: 0, r: 0, facing: 0 }, ...ring]));
    expect(blocked.stations.f.reachable).toBe(false);
    expect(blocked.stations.f.breakdown.some((b) => b.source === "unreachable")).toBe(true);

    const open = evaluateLayout(config, walled);
    expect(open.stations.f.reachable).toBe(true);

    const noDoor = evaluateLayout(config, layout([{ id: "f", def: "forge", q: 0, r: 0, facing: 0 }]));
    expect(noDoor.warnings.some((w) => w.code === "no-door")).toBe(true);
    expect(noDoor.stations.f.reachable).toBe(false);
  });
});

describe("resolveCapabilities", () => {
  it("resolves own, side-restricted attachment, and nearby station capabilities", () => {
    // Forge facing 1; bellows needs station-relative side 3. Direction 4 (0,-1) -> relative (4-1)=3.
    const good = layout([
      { id: "f", def: "forge", q: 0, r: 0, facing: 1 },
      { id: "b", def: "bellows", q: 0, r: -1 },
      { id: "a", def: "anvil", q: 3, r: 0, facing: 1 },
    ]);
    const grants = resolveCapabilities(config, good, "f");
    expect(grants.some((g) => g.capability === "forced_air" && g.source === "attachment")).toBe(true);
    expect(requirementMet(grants, { capability: "heat" })).toBe(true);
    expect(requirementMet(grants, { capability: "hammering" })).toBe(false);
    expect(requirementMet(grants, { capability: "hammering", range: 2 })).toBe(false);
    expect(requirementMet(grants, { capability: "hammering", range: 3 })).toBe(true);

    const wrongSide = layout([
      { id: "f", def: "forge", q: 0, r: 0, facing: 1 },
      { id: "b", def: "bellows", q: 1, r: 0 },
    ]);
    expect(requirementMet(resolveCapabilities(config, wrongSide, "f"), { capability: "forced_air" })).toBe(false);
  });

  it("lets one attachment serve two stations", () => {
    const l = layout([
      { id: "w1", def: "workbench", q: -1, r: 0, facing: 1 },
      { id: "w2", def: "workbench", q: 1, r: 0, facing: 1 },
      { id: "v", def: "vice", q: 0, r: 0 },
    ]);
    expect(requirementMet(resolveCapabilities(config, l, "w1"), { capability: "clamping" })).toBe(true);
    expect(requirementMet(resolveCapabilities(config, l, "w2"), { capability: "clamping" })).toBe(true);
  });
});

describe("diffLayouts / layoutCostHours", () => {
  const before: LayoutPlacement[] = [
    { itemId: "f", q: 0, r: 0, facing: 0 },
    { itemId: "a", q: 1, r: 0, facing: 0 },
    { itemId: "x", q: 2, r: 0, facing: 0 },
  ];
  const after: LayoutPlacement[] = [
    { itemId: "f", q: 0, r: 0, facing: 2 },
    { itemId: "a", q: 3, r: 0, facing: 0 },
    { itemId: "n", q: 0, r: 2, facing: 0 },
  ];
  const items = {
    f: { definitionId: "forge", quality: 50 },
    a: { definitionId: "anvil", quality: 50 },
    x: { definitionId: "lamp", quality: 50 },
    n: { definitionId: "workbench", quality: 50 },
  };

  it("classifies changes", () => {
    const d = diffLayouts(before, after);
    expect(d.added.map((e) => e.itemId)).toEqual(["n"]);
    expect(d.removed.map((e) => e.itemId)).toEqual(["x"]);
    expect(d.moved.map((e) => e.itemId)).toEqual(["a"]);
    expect(d.rotated.map((e) => e.itemId)).toEqual(["f"]);
  });

  it("costs place, move (weight*size*distance), rotate; removal is free", () => {
    const cost = layoutCostHours(config, diffLayouts(before, after), items);
    expect(cost.perItem.n).toBe(1.5);
    expect(cost.perItem.a).toBeCloseTo(0.5 + 10 * 2 * 2 * config.moveHoursPerUnit, 5);
    expect(cost.perItem.f).toBe(config.rotateHours);
    expect(cost.perItem.x).toBeUndefined();
    expect(cost.hours).toBeCloseTo(1.5 + 0.5 + 2 + config.rotateHours, 5);
  });

  it("heavier or farther moves cost more", () => {
    const move = (def: string, dist: number) =>
      layoutCostHours(
        config,
        diffLayouts([{ itemId: "i", q: 0, r: 0, facing: 0 }], [{ itemId: "i", q: dist, r: 0, facing: 0 }]),
        { i: { definitionId: def, quality: 50 } },
      ).hours;
    expect(move("anvil", 4)).toBeGreaterThan(move("anvil", 1));
    expect(move("anvil", 2)).toBeGreaterThan(move("lamp", 2));
  });
});

describe("planLayoutCommit", () => {
  const items = {
    d: { definitionId: "door", quality: 50 },
    f: { definitionId: "forge", quality: 50 },
  };
  const current: LayoutPlacement[] = [{ itemId: "d", q: -3, r: 0, facing: 0 }];
  const args = (requested: LayoutPlacement[]) => ({ tiles, items, current, requested });

  it("prices a valid change in game seconds", () => {
    const plan = planLayoutCommit(config, args([...current, { itemId: "f", q: 0, r: 0, facing: 1 }]));
    expect(plan).toMatchObject({ ok: true, gameSeconds: 2 * 3600 });
  });

  it("rejects no-ops and invalid layouts", () => {
    expect(planLayoutCommit(config, args(current))).toEqual({ ok: false, reason: "no-changes" });
    const bad = planLayoutCommit(config, args([...current, { itemId: "f", q: 99, r: 0, facing: 1 }]));
    expect(bad).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("rejects items the player doesn't own", () => {
    const bad = planLayoutCommit(config, args([...current, { itemId: "stolen", q: 0, r: 0, facing: 1 }]));
    expect(bad).toMatchObject({ ok: false, reason: "invalid" });
  });
});
