import { describe, expect, it } from "vitest";
import { interpolateAlongLine } from "./routeInterpolation.js";

describe("interpolateAlongLine", () => {
  const line: [number, number][] = [
    [-123.12, 49.28],
    [-123.11, 49.28],
    [-123.1, 49.28],
  ];

  it("returns the start point at fraction 0", () => {
    expect(interpolateAlongLine(line, 0)).toEqual({ lat: 49.28, lng: -123.12 });
  });

  it("returns the end point at fraction 1", () => {
    expect(interpolateAlongLine(line, 1)).toEqual({ lat: 49.28, lng: -123.1 });
  });

  it("returns a midpoint roughly halfway for an evenly-spaced line", () => {
    const midpoint = interpolateAlongLine(line, 0.5);
    expect(midpoint.lng).toBeCloseTo(-123.11, 2);
    expect(midpoint.lat).toBeCloseTo(49.28, 2);
  });

  it("clamps fractions outside 0..1", () => {
    expect(interpolateAlongLine(line, -1)).toEqual(interpolateAlongLine(line, 0));
    expect(interpolateAlongLine(line, 2)).toEqual(interpolateAlongLine(line, 1));
  });

  it("handles a single-point line", () => {
    expect(interpolateAlongLine([[-123.12, 49.28]], 0.5)).toEqual({ lat: 49.28, lng: -123.12 });
  });
});
