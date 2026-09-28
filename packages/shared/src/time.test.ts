import { describe, expect, it } from "vitest";
import {
  gameSecondsForDistance,
  gameSecondsFromRealSeconds,
  realMsForDistance,
  realSecondsFromGameSeconds,
  tripProgress,
} from "./time.js";

describe("time math", () => {
  it("a 5km walk takes 1 game hour", () => {
    expect(gameSecondsForDistance(5)).toBe(3600);
  });

  it("a 5km walk takes 60 real seconds", () => {
    expect(realMsForDistance(5)).toBe(60_000);
  });

  it("converts real seconds to game seconds at 60:1", () => {
    expect(gameSecondsFromRealSeconds(1)).toBe(60);
  });

  it("round-trips game <-> real seconds", () => {
    const gameSeconds = gameSecondsForDistance(12.5);
    const realSeconds = realSecondsFromGameSeconds(gameSeconds);
    expect(gameSecondsFromRealSeconds(realSeconds)).toBeCloseTo(gameSeconds);
  });

  it("computes trip progress fraction", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-01-01T00:01:00Z");
    expect(tripProgress(start, end, start)).toBe(0);
    expect(tripProgress(start, end, end)).toBe(1);
    expect(tripProgress(start, end, new Date("2026-01-01T00:00:30Z"))).toBeCloseTo(0.5);
  });

  it("clamps progress outside the trip window", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-01-01T00:01:00Z");
    expect(tripProgress(start, end, new Date("2025-12-31T23:00:00Z"))).toBe(0);
    expect(tripProgress(start, end, new Date("2026-01-02T00:00:00Z"))).toBe(1);
  });
});
