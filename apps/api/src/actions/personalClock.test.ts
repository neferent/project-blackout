import { describe, expect, it } from "vitest";
import "./travel.js"; // registers the travel handler
import { computePersonalClock } from "./personalClock.js";

describe("computePersonalClock", () => {
  const createdAt = new Date("2026-01-01T00:00:00Z");

  it("equals createdAt with no actions", () => {
    expect(computePersonalClock(createdAt, [], createdAt).getTime()).toBe(createdAt.getTime());
  });

  it("advances by full game duration once a travel action completes", () => {
    const startsAt = new Date("2026-01-01T00:00:00Z");
    const endsAt = new Date("2026-01-01T00:01:00Z"); // 60 real seconds = 5km walk = 1 game hour
    const now = new Date("2026-01-01T00:05:00Z"); // well after completion

    const clock = computePersonalClock(
      createdAt,
      [{ kind: "travel", data: { distanceKm: 5 }, startsAt, endsAt }],
      now,
    );

    expect(clock.getTime() - createdAt.getTime()).toBe(3600 * 1000); // +1 game hour
  });

  it("credits partial game time for an in-progress action", () => {
    const startsAt = new Date("2026-01-01T00:00:00Z");
    const endsAt = new Date("2026-01-01T00:01:00Z");
    const now = new Date("2026-01-01T00:00:30Z"); // halfway through the 60s trip

    const clock = computePersonalClock(
      createdAt,
      [{ kind: "travel", data: { distanceKm: 5 }, startsAt, endsAt }],
      now,
    );

    expect(clock.getTime() - createdAt.getTime()).toBeCloseTo(1800 * 1000, -2); // ~half a game hour
  });

  it("sums multiple completed actions in order", () => {
    const first = {
      kind: "travel" as const,
      data: { distanceKm: 5 },
      startsAt: new Date("2026-01-01T00:00:00Z"),
      endsAt: new Date("2026-01-01T00:01:00Z"),
    };
    const second = {
      kind: "travel" as const,
      data: { distanceKm: 10 },
      startsAt: new Date("2026-01-01T00:01:00Z"),
      endsAt: new Date("2026-01-01T00:03:00Z"),
    };
    const now = new Date("2026-01-01T00:10:00Z");

    const clock = computePersonalClock(createdAt, [first, second], now);

    expect(clock.getTime() - createdAt.getTime()).toBe((3600 + 7200) * 1000);
  });
});
