import { describe, expect, it } from "vitest";
import { SEED_BASE_LAYOUT_CONFIG as config } from "./seed.js";
import { defaultFacing, placeItem, removePlacement, rotatePlacement, validDropTiles } from "./draft.js";
import { hexOfRadius } from "./testUtil.js";
import type { LayoutPlacement } from "./engine.js";

const tiles = hexOfRadius(3, "indoor").map((t) => (t.q === 3 && t.r === 0 ? { ...t, tileType: "road" as const } : t));
const items = {
  f: { definitionId: "forge", quality: 40 },
  a: { definitionId: "anvil", quality: 40 },
  g: { definitionId: "garden_plot", quality: 40 },
};
const ctx = (placements: LayoutPlacement[]) => ({ tiles, items, placements });

describe("placeItem", () => {
  it("places a new item with a facing that leaves its front open", () => {
    const r = placeItem(config, ctx([{ itemId: "a", q: 1, r: 0, facing: 0 }]), "f", { q: 0, r: 0 });
    expect(r.ok && r.placements.find((p) => p.itemId === "f")?.facing).not.toBe(0);
  });

  it("moves an existing item and keeps its facing", () => {
    const r = placeItem(config, ctx([{ itemId: "f", q: 0, r: 0, facing: 4 }]), "f", { q: 1, r: -1 });
    expect(r).toEqual({ ok: true, placements: [{ itemId: "f", q: 1, r: -1, facing: 4 }] });
  });

  it("refuses wrong slot, taken tiles, off-board, and unknown items", () => {
    expect(placeItem(config, ctx([]), "f", { q: 3, r: 0 })).toMatchObject({ ok: false });
    expect(placeItem(config, ctx([]), "g", { q: 0, r: 0 })).toMatchObject({ ok: false });
    expect(placeItem(config, ctx([{ itemId: "a", q: 0, r: 0, facing: 0 }]), "f", { q: 0, r: 0 })).toEqual({
      ok: false,
      message: "That tile is taken",
    });
    expect(placeItem(config, ctx([]), "f", { q: 9, r: 9 })).toMatchObject({ ok: false });
    expect(placeItem(config, ctx([]), "nope", { q: 0, r: 0 })).toMatchObject({ ok: false });
  });
});

describe("rotate / remove / drop targets", () => {
  const placed: LayoutPlacement[] = [{ itemId: "f", q: 0, r: 0, facing: 5 }];

  it("rotates clockwise and wraps", () => {
    expect(rotatePlacement(placed, "f")[0].facing).toBe(0);
    expect(rotatePlacement(placed, "f", -1)[0].facing).toBe(4);
  });

  it("removes", () => {
    expect(removePlacement(placed, "f")).toEqual([]);
  });

  it("lists legal drop tiles: slot-compatible and free (own tile counts as free)", () => {
    const targets = validDropTiles(config, ctx([...placed, { itemId: "a", q: 1, r: 0, facing: 0 }]), "f");
    const has = (q: number, r: number) => targets.some((t) => t.q === q && t.r === r);
    expect(has(0, 0)).toBe(true);
    expect(has(1, 0)).toBe(false);
    expect(has(3, 0)).toBe(false);
  });

  it("defaultFacing falls back to 0 when boxed in", () => {
    const ring = [
      { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 },
    ].map((p, i) => ({ itemId: `x${i}`, ...p, facing: 0 }));
    expect(defaultFacing(tiles, ring, { q: 0, r: 0 })).toBe(0);
  });
});
