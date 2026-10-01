import { describe, expect, it } from "vitest";
import { dangerFromDistanceMeters } from "./dangerMath.js";

describe("dangerFromDistanceMeters", () => {
  it("is maxed out at or within the danger radius", () => {
    expect(dangerFromDistanceMeters(0)).toBe(1);
    expect(dangerFromDistanceMeters(50)).toBe(1);
  });

  it("is zero at or beyond the falloff radius", () => {
    expect(dangerFromDistanceMeters(300)).toBe(0);
    expect(dangerFromDistanceMeters(1000)).toBe(0);
  });

  it("falls off linearly in between", () => {
    expect(dangerFromDistanceMeters(175)).toBeCloseTo(0.5, 5); // halfway between 50 and 300
  });
});
