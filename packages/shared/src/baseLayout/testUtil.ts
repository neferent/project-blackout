import type { TileType } from "./config.js";
import type { LayoutTile } from "./engine.js";

/** All axial cells within `radius` rings of (0,0), all of the given tile type. */
export function hexOfRadius(radius: number, tileType: TileType): LayoutTile[] {
  const out: LayoutTile[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      out.push({ q, r, tileType });
    }
  }
  return out;
}
