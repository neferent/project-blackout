import { describe, expect, it } from "vitest";
import { dangerFromDistanceMeters, dangerTierFromDistanceMeters } from "./dangerMath.js";

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

describe("dangerTierFromDistanceMeters", () => {
  it("is off-limits at or within the danger radius", () => {
    expect(dangerTierFromDistanceMeters(0)).toBe("off-limits");
    expect(dangerTierFromDistanceMeters(50)).toBe("off-limits");
  });

  it("is safe at or beyond the falloff radius", () => {
    expect(dangerTierFromDistanceMeters(300)).toBe("safe");
    expect(dangerTierFromDistanceMeters(1000)).toBe("safe");
  });

  it("buckets the middle of the falloff range into very-dangerous/slightly-dangerous thirds", () => {
    expect(dangerTierFromDistanceMeters(100)).toBe("very-dangerous"); // value ~0.8
    expect(dangerTierFromDistanceMeters(175)).toBe("slightly-dangerous"); // value 0.5
  });
});
