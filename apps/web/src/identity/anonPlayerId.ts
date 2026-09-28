const STORAGE_KEY = "blackout.anonPlayerKey";
export const ANON_KEY_HEADER = "x-anon-player-key";

/**
 * POC-only anonymous identity: a random id generated on first visit and kept
 * in localStorage. Isolated here so it's the single place to swap for real
 * auth (Better Auth) later.
 */
export function getAnonPlayerKey(): string {
  let key = localStorage.getItem(STORAGE_KEY);
  if (!key) {
    key = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, key);
  }
  return key;
}
