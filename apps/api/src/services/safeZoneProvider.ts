import type { LatLng } from "@blackout/shared";

/**
 * Player-safe areas (home bases, eventually). Always empty in the POC —
 * dangerZoneGenerator.ts drops any zone corner that falls inside one, so
 * spawned zones never encroach on safety once this is populated for real.
 */
export interface SafeZoneProvider {
  isInSafeZone(point: LatLng): Promise<boolean>;
}

export const stubSafeZoneProvider: SafeZoneProvider = {
  async isInSafeZone(_point: LatLng): Promise<boolean> {
    return false;
  },
};
