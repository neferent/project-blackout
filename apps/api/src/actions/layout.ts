import type { LayoutActionData } from "@blackout/shared";
import { registerActionHandler, type ActionHandler } from "./registry.js";

/** Duration is the server-computed cost of the layout diff, stored on the action at commit. */
export const layoutActionHandler: ActionHandler<LayoutActionData> = {
  kind: "layout",
  gameDurationSeconds(data) {
    return data.gameSeconds;
  },
};

registerActionHandler(layoutActionHandler);
