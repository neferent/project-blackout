import type { LatLng, LineStringGeometry } from "@blackout/shared";

export interface EncounterPoint {
  position: LatLng;
  /** Fraction (0..1) along the route where this encounter sits. */
  fraction: number;
}

/**
 * Called when a trip is created; returns points along the route where travel
 * should be able to pause. Empty in the POC — no encounters exist yet.
 */
export interface EncounterPlanner {
  planEncounters(route: LineStringGeometry): Promise<EncounterPoint[]>;
}

export const stubEncounterPlanner: EncounterPlanner = {
  async planEncounters(_route: LineStringGeometry): Promise<EncounterPoint[]> {
    return [];
  },
};
