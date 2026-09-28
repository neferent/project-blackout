import { tripProgress, type Action } from "@blackout/shared";
import { getActionHandler } from "./registry.js";

/**
 * A player's personal clock: their creation time advanced by the game-time
 * cost of every action they've taken, credited proportionally to how much of
 * each action has elapsed in real time by `now`. Never trusts client time.
 */
export function computePersonalClock(
  createdAt: Date,
  actionsChronological: Pick<Action, "kind" | "data" | "startsAt" | "endsAt">[],
  now: Date,
): Date {
  let clockMs = createdAt.getTime();

  for (const action of actionsChronological) {
    const handler = getActionHandler(action.kind);
    const gameDurationSeconds = handler.gameDurationSeconds(action.data);
    const fraction = tripProgress(action.startsAt, action.endsAt, now);
    clockMs += gameDurationSeconds * 1000 * fraction;
  }

  return new Date(clockMs);
}
