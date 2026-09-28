import type { Context, Next } from "hono";

/**
 * POC-only anonymous identity: the client generates an id on first visit,
 * stores it in localStorage, and sends it on every request via this header.
 * Isolated here so it's a single module to swap for Better Auth later.
 */
export const ANON_KEY_HEADER = "x-anon-player-key";

export function requireAnonKey(c: Context, next: Next) {
  const anonKey = c.req.header(ANON_KEY_HEADER);
  if (!anonKey) {
    return c.json({ error: `Missing ${ANON_KEY_HEADER} header` }, 400);
  }
  c.set("anonKey", anonKey);
  return next();
}

declare module "hono" {
  interface ContextVariableMap {
    anonKey: string;
  }
}
