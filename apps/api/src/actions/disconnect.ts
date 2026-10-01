import { DISCONNECT_ACTION_GAME_SECONDS, type DisconnectActionData } from "@blackout/shared";
import { registerActionHandler, type ActionHandler } from "./registry.js";

/** Fixed cost regardless of the building — unlike travel, there's no distance component. */
export const disconnectActionHandler: ActionHandler<DisconnectActionData> = {
  kind: "disconnect",
  gameDurationSeconds() {
    return DISCONNECT_ACTION_GAME_SECONDS;
  },
};

registerActionHandler(disconnectActionHandler);
