/**
 * Danger per H3 cell, fed into routing as avoid-zones/costs. Always 0 in the
 * POC; later, phasing/blight/entities will populate this one layer.
 */
export interface DangerProvider {
  dangerForCell(h3Cell: string): Promise<number>;
}

export const stubDangerProvider: DangerProvider = {
  async dangerForCell(_h3Cell: string): Promise<number> {
    return 0;
  },
};
