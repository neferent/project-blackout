import type { Designation, TileType } from "@blackout/shared";

export const TILE_COLORS: Record<TileType, string> = {
  indoor: "#6a655c",
  yard: "#3a3b25",
  garden: "#274d31",
  paved: "#4b4d52",
  water: "#1f4a66",
  road: "#262626",
};

export const TILE_NAMES: Record<TileType, string> = {
  indoor: "Indoor",
  yard: "Yard",
  garden: "Garden",
  paved: "Paved",
  water: "Water",
  road: "Road",
};

/** Second half of the tap label, e.g. "Indoor · building". */
export const TILE_DETAILS: Record<TileType, string> = {
  indoor: "building",
  yard: "open ground",
  garden: "planted land",
  paved: "convertible",
  water: "impassable",
  road: "convertible",
};

export const DESIGNATION_NAMES: Record<Designation, string> = {
  walkway: "walkway",
  clear: "kept clear",
};

export const tileLabel = (type: TileType): string => `${TILE_NAMES[type]} · ${TILE_DETAILS[type]}`;

export const TILE_TYPE_ORDER: TileType[] = ["indoor", "yard", "garden", "paved", "road", "water"];
