import { describe, expect, it } from "vitest";
import { tilesFromHexGrid, tileTypeForClassification } from "./tiles.js";

describe("tile type mapping", () => {
  it("maps each board classification to a tile type", () => {
    expect(tileTypeForClassification("building")).toBe("indoor");
    expect(tileTypeForClassification("water")).toBe("water");
    expect(tileTypeForClassification("road")).toBe("road");
    expect(tileTypeForClassification("landcover")).toBe("garden");
    expect(tileTypeForClassification("empty")).toBe("yard");
    expect(tileTypeForClassification("something-new")).toBe("yard");
  });

  it("converts a whole grid, preserving coordinates", () => {
    expect(tilesFromHexGrid({ cells: [{ q: 1, r: -1, classification: "building" }] })).toEqual([
      { q: 1, r: -1, tileType: "indoor" },
    ]);
  });
});
