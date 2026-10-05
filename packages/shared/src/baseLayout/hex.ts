/**
 * Axial hex helpers for the base board (flat-top, q/r relative to the base center).
 * Facing 0 = +q, increasing clockwise on screen (y down).
 */
export interface Axial {
  q: number;
  r: number;
}

/** Neighbor offsets indexed by facing 0..5, clockwise. */
export const HEX_DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

export const hexKey = (q: number, r: number): string => `${q},${r}`;

export function normalizeFacing(facing: number): number {
  return ((facing % 6) + 6) % 6;
}

export function hexNeighbor(at: Axial, facing: number): Axial {
  const d = HEX_DIRECTIONS[normalizeFacing(facing)];
  return { q: at.q + d.q, r: at.r + d.r };
}

export function hexNeighbors(at: Axial): Axial[] {
  return HEX_DIRECTIONS.map((d) => ({ q: at.q + d.q, r: at.r + d.r }));
}

export function hexDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/**
 * Facing (0..5) pointing from `from` to the adjacent tile `to`, or null if they
 * are not neighbors.
 */
export function directionBetween(from: Axial, to: Axial): number | null {
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  const i = HEX_DIRECTIONS.findIndex((d) => d.q === dq && d.r === dr);
  return i === -1 ? null : i;
}
