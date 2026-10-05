import { describe, expect, it } from "vitest";
import { interactionCellCenter, interactionCellForPosition } from "./h3.js";

describe("interactionCellForPosition / interactionCellCenter", () => {
  it("round-trips a point to its cell's center, stable under re-snapping", () => {
    const point = { lat: 49.2827, lng: -123.1207 };
    const cell = interactionCellForPosition(point);
    const center = interactionCellCenter(cell);

    // The center itself falls in the same cell — snapping is idempotent.
    expect(interactionCellForPosition(center)).toBe(cell);
  });

  it("collapses two nearby points in the same hex onto the same cell", () => {
    const a = interactionCellForPosition({ lat: 49.28260, lng: -123.12090 });
    const b = interactionCellForPosition({ lat: 49.28262, lng: -123.12092 });
    expect(a).toBe(b);
  });
});
