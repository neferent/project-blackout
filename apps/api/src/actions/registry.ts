import type { ActionKind } from "@blackout/shared";

/**
 * One handler per action kind. New kinds (scavenge, craft, rest, ...) register
 * here without touching the generic action pipeline (personal clock, resolve-on-read).
 */
export interface ActionHandler<TData = unknown> {
  kind: ActionKind;
  /** Game-world seconds this action occupies, derived from its stored data. */
  gameDurationSeconds(data: TData): number;
}

const registry = new Map<ActionKind, ActionHandler<any>>();

export function registerActionHandler(handler: ActionHandler<any>): void {
  registry.set(handler.kind, handler);
}

export function getActionHandler(kind: ActionKind): ActionHandler<any> {
  const handler = registry.get(kind);
  if (!handler) {
    throw new Error(`No action handler registered for kind "${kind}"`);
  }
  return handler;
}
