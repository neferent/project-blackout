import { describe, expect, it } from "vitest";
import { interpolateAlongLine, splitLineAtFraction } from "./routeInterpolation.js";

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

describe("splitLineAtFraction", () => {
  const line: [number, number][] = [
    [-123.12, 49.28],
    [-123.11, 49.28],
    [-123.1, 49.28],
  ];

  it("puts everything in remaining at fraction 0", () => {
    const { traveled, remaining } = splitLineAtFraction(line, 0);
    expect(traveled).toEqual([line[0]]);
    expect(remaining).toEqual(line);
  });

  it("puts everything in traveled at fraction 1", () => {
    const { traveled, remaining } = splitLineAtFraction(line, 1);
    expect(traveled).toEqual(line);
    expect(remaining).toEqual([line[2]]);
  });

  it("splits at the midpoint, sharing the split vertex between both halves", () => {
    const { traveled, remaining } = splitLineAtFraction(line, 0.5);
    expect(traveled.at(-1)).toEqual(remaining[0]);
    expect(traveled[0]).toEqual(line[0]);
    expect(remaining.at(-1)).toEqual(line[2]);
  });
});
