import { gameSecondsForDistance, type TravelActionData } from "@blackout/shared";
import { registerActionHandler, type ActionHandler } from "./registry.js";

export const travelActionHandler: ActionHandler<TravelActionData> = {
  kind: "travel",
  gameDurationSeconds(data) {
    return gameSecondsForDistance(data.distanceKm);
  },
};

registerActionHandler(travelActionHandler);
