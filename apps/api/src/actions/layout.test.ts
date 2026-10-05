import { describe, expect, it } from "vitest";
import { computePersonalClock } from "./personalClock.js";
import "./layout.js";

describe("layout action", () => {
  it("advances the personal clock by its stored game seconds, proportionally while running", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const startsAt = new Date("2026-01-01T01:00:00Z");
    const data = { baseId: "b", baseVersion: 0, placements: [], hours: 6, gameSeconds: 6 * 3600 };
    // 6 game hours at 60:1 = 6 real minutes.
    const endsAt = new Date(startsAt.getTime() + 6 * 60 * 1000);
    const action = { kind: "layout" as const, data, startsAt, endsAt };

    const done = computePersonalClock(createdAt, [action], new Date(endsAt.getTime() + 1000));
    expect(done.getTime() - createdAt.getTime()).toBe(6 * 3600 * 1000);

    const half = computePersonalClock(createdAt, [action], new Date(startsAt.getTime() + 3 * 60 * 1000));
    expect(half.getTime() - createdAt.getTime()).toBe(3 * 3600 * 1000);
  });
});
