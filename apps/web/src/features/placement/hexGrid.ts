import { cellToBoundary, cellToLatLng } from "h3-js";
import type { Map as MapLibreMap } from "maplibre-gl";
import { BASE_HEX_RADIUS, MIN_BASE_BUILDING_CELLS, type LatLng } from "@blackout/shared";

export { BASE_HEX_RADIUS, MIN_BASE_BUILDING_CELLS };

export type HexCellClassification = "building" | "water" | "road" | "landcover" | "empty";

// Shared with HexGridCanvas (the board render) and StartPicker's legend/popover, so the
// color swatch next to "Building: 12%" always matches what's actually painted on the grid.
export const CLASSIFICATION_COLORS: Record<HexCellClassification, string> = {
  building: "#5a5650",
  water: "#1f4a66",
  road: "#2a2a2a",
  landcover: "#274d31",
  empty: "#17160f",
};

export const CLASSIFICATION_LABELS: Record<HexCellClassification, string> = {
  building: "Building",
  water: "Water",
  road: "Road",
  landcover: "Open land",
  empty: "Empty",
};

export const CLASSIFICATION_ORDER: HexCellClassification[] = ["building", "road", "landcover", "water", "empty"];

export interface AxialCoord {
  q: number;
  r: number;
}

export interface HexCellData extends AxialCoord {
  classification: HexCellClassification;
}

export interface HexGridResult {
  /** "Radius" of the hex-of-hexes board — see BASE_HEX_RADIUS. Fixed across every base. */
  radius: number;
  cells: HexCellData[];
  /** Fraction of cells by classification, for the percentage breakdown. */
  coverage: Record<HexCellClassification, number>;
}

// BASE_HEX_RADIUS/MIN_BASE_BUILDING_CELLS now live in packages/shared/src/constants.ts
// (re-exported above) since the server validates the same minimum on create-player.
// Adjacency is the actual gameplay mechanic (placed items bonus each other when
// touching), and hex cells give every cell exactly 6 equidistant neighbors, so
// "adjacent" never needs the orthogonal-vs-diagonal distinction a square grid would
// force. Unlike the earlier square-grid + hexagon-mask approach, a hex-of-hexes
// exactly tiles its own hexagonal outline with no leftover "outside" cells to mask out.

export type HexGridWarning = "no-buildings" | "too-few-buildings" | "mostly-water" | "mostly-empty" | null;

export function countBuildingCells(grid: HexGridResult): number {
  return grid.cells.filter((cell) => cell.classification === "building").length;
}

/** Hard-blocking (too-few/no buildings) vs. advisory (terrain-dominant) — see callers. */
export function hexGridWarning(grid: HexGridResult): HexGridWarning {
  const buildingCells = countBuildingCells(grid);
  if (buildingCells === 0) return "no-buildings";
  if (buildingCells < MIN_BASE_BUILDING_CELLS) return "too-few-buildings";
  if (grid.coverage.water >= 0.9) return "mostly-water";
  if (grid.coverage.empty + grid.coverage.landcover >= 0.95) return "mostly-empty";
  return null;
}

export function meetsMinimumBuildings(grid: HexGridResult): boolean {
  return countBuildingCells(grid) >= MIN_BASE_BUILDING_CELLS;
}

const CLASSIFIED_LAYERS = [
  "building",
  "water",
  "road-major",
  "road-ramp",
  "road-minor",
  "landcover",
  "landuse",
  "park",
] as const;

// Half-width of the road hit-band, meters. Flat per-class guess — good enough for a visual
// preview grid; Phase 2's server-side reclassification can be pickier if it matters.
const ROAD_HIT_RADIUS_METERS = 3.5;

// Equirectangular local-meters projection, centered on the hex. Accurate to well under a
// centimeter of error over a ~50m hex — nowhere near enough distortion at this scale to
// matter for a placement grid.
const METERS_PER_DEGREE_LAT = 111_320;

function metersPerDegreeLng(atLat: number): number {
  return METERS_PER_DEGREE_LAT * Math.cos((atLat * Math.PI) / 180);
}

// Axial neighbor directions — constant regardless of flat/pointy-top orientation, since
// they're defined in cube-coordinate space (see hexOfHexes/axialToPixel).
const AXIAL_DIRECTIONS: AxialCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

function neighborsOf(coord: AxialCoord): AxialCoord[] {
  return AXIAL_DIRECTIONS.map((d) => ({ q: coord.q + d.q, r: coord.r + d.r }));
}

function cellKey(coord: AxialCoord): string {
  return `${coord.q},${coord.r}`;
}

// A landcover/empty cell almost entirely boxed in by building is near-certainly the same
// building clipped by tile-boundary/zoom-simplification noise in the source geometry (see
// classifyHexGrid's docstring on tile simplification), not a genuine gap — fold it into
// the building it's sitting inside of. Runs as a settling pass (cellular-automaton style,
// each pass reading the previous pass's snapshot) since filling one cell can newly
// surround its own neighbor.
const BUILDING_FILL_NEIGHBOR_THRESHOLD = 5;

function fillSurroundedOpenCells(cells: HexCellData[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    const classificationAtPassStart = new Map(cells.map((cell) => [cellKey(cell), cell.classification]));
    for (const cell of cells) {
      if (cell.classification !== "landcover" && cell.classification !== "empty") continue;
      const buildingNeighbors = neighborsOf(cell).filter(
        (neighbor) => classificationAtPassStart.get(cellKey(neighbor)) === "building",
      ).length;
      if (buildingNeighbors >= BUILDING_FILL_NEIGHBOR_THRESHOLD) {
        cell.classification = "building";
        changed = true;
      }
    }
  }
}

export interface Point {
  x: number;
  y: number;
}

function toLocalMeters(point: LatLng, center: LatLng, mPerDegLng: number): Point {
  return {
    x: (point.lng - center.lng) * mPerDegLng,
    y: (point.lat - center.lat) * METERS_PER_DEGREE_LAT,
  };
}

/** Every axial (q, r) in a flat-top hex-of-hexes of the given radius — cube-coordinate bounded. */
export function hexOfHexes(radius: number): AxialCoord[] {
  const coords: AxialCoord[] = [];
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r++) coords.push({ q, r });
  }
  return coords;
}

/** Flat-top axial-to-pixel (Red Blob Games layout), in abstract units where `size` is the cell's circumradius. */
export function axialToPixel({ q, r }: AxialCoord, size: number): Point {
  return {
    x: size * (1.5 * q),
    y: size * ((Math.sqrt(3) / 2) * q + Math.sqrt(3) * r),
  };
}

/** The 6 corners of a flat-top hex cell centered at `center`, same angle convention used for the overall base outline. */
export function hexCorners(center: Point, size: number): Point[] {
  return [0, 60, 120, 180, 240, 300].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return { x: center.x + size * Math.cos(rad), y: center.y + size * Math.sin(rad) };
  });
}

/** Even-odd ray casting against a polygon's outer ring — works in any consistent {x,y} unit. */
function pointInRing(point: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const crosses = a.y > point.y !== b.y > point.y;
    if (!crosses) continue;
    const xAtY = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (point.x < xAtY) inside = !inside;
  }
  return inside;
}

function pointToSegmentDistance(point: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSq));
  const projX = a.x + t * abx;
  const projY = a.y + t * aby;
  return Math.hypot(point.x - projX, point.y - projY);
}

/** Bounding box of every cell's corners, in whatever unit `size` is — the true visual extent of the board. */
export function hexOfHexesBounds(radius: number, size: number): { minX: number; maxX: number; minY: number; maxY: number } {
  const corners = hexOfHexes(radius).flatMap((coord) => hexCorners(axialToPixel(coord, size), size));
  return {
    minX: Math.min(...corners.map((p) => p.x)),
    maxX: Math.max(...corners.map((p) => p.x)),
    minY: Math.min(...corners.map((p) => p.y)),
    maxY: Math.max(...corners.map((p) => p.y)),
  };
}

/**
 * Classifies a hex's interior into the fixed hex-of-hexes board (see BASE_HEX_RADIUS),
 * always true-north aligned. The board's own abstract layout (computed with size=1) is
 * linearly mapped — independently per axis — onto the real hex's actual bounding box in
 * meters, so the real OSM features stretch/squish to fill the fixed board rather than the
 * board's shape or cell count varying per hex. Reads from already-rendered vector tiles
 * (queryRenderedFeatures), so it's fast enough to re-run on every hex click, but it's a
 * *preview*: tile geometry is zoom-simplified. Phase 2's persisted base layout re-derives
 * this server-side from full-fidelity OSM data before it's trusted for gameplay.
 */
export function classifyHexGrid(map: MapLibreMap, cell: string): HexGridResult {
  const [centerLat, centerLng] = cellToLatLng(cell);
  const center: LatLng = { lat: centerLat, lng: centerLng };
  const mPerDegLng = metersPerDegreeLng(centerLat);

  const boundary = (cellToBoundary(cell, true) as [number, number][]).map(([lng, lat]) =>
    toLocalMeters({ lat, lng }, center, mPerDegLng),
  );
  const worldMinX = Math.min(...boundary.map((p) => p.x));
  const worldMaxX = Math.max(...boundary.map((p) => p.x));
  const worldMinY = Math.min(...boundary.map((p) => p.y));
  const worldMaxY = Math.max(...boundary.map((p) => p.y));

  const layout = hexOfHexes(BASE_HEX_RADIUS);
  const abstractBounds = hexOfHexesBounds(BASE_HEX_RADIUS, 1);
  const scaleX = (worldMaxX - worldMinX) / (abstractBounds.maxX - abstractBounds.minX);
  const scaleY = (worldMaxY - worldMinY) / (abstractBounds.maxY - abstractBounds.minY);

  // Pixel bbox of the hex on screen, to scope the tile query to what's actually relevant.
  const screenPoints = (cellToBoundary(cell, true) as [number, number][]).map(([lng, lat]) =>
    map.project([lng, lat]),
  );
  const pxMin: [number, number] = [
    Math.min(...screenPoints.map((p) => p.x)),
    Math.min(...screenPoints.map((p) => p.y)),
  ];
  const pxMax: [number, number] = [
    Math.max(...screenPoints.map((p) => p.x)),
    Math.max(...screenPoints.map((p) => p.y)),
  ];
  const features = map.queryRenderedFeatures([pxMin, pxMax], { layers: [...CLASSIFIED_LAYERS] });

  const polygons: { kind: "building" | "water" | "landcover"; rings: Point[][] }[] = [];
  const lines: Point[][] = [];

  for (const feature of features) {
    const layerId = feature.layer.id;
    const kind: "building" | "water" | "landcover" | "road" =
      layerId === "building" ? "building" : layerId === "water" ? "water" : layerId.startsWith("road") ? "road" : "landcover";
    const geometry = feature.geometry;

    if (kind === "road") {
      const lineStrings =
        geometry.type === "LineString"
          ? [geometry.coordinates]
          : geometry.type === "MultiLineString"
            ? geometry.coordinates
            : [];
      for (const line of lineStrings) {
        lines.push((line as [number, number][]).map(([lng, lat]) => toLocalMeters({ lat, lng }, center, mPerDegLng)));
      }
      continue;
    }

    const ringGroups =
      geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    for (const rings of ringGroups) {
      polygons.push({
        kind,
        rings: (rings as [number, number][][]).map((ring) => ring.map(([lng, lat]) => toLocalMeters({ lat, lng }, center, mPerDegLng))),
      });
    }
  }

  const cells: HexCellData[] = layout.map((coord) => {
    const abstractCenter = axialToPixel(coord, 1);
    const worldPoint: Point = {
      x: worldMinX + (abstractCenter.x - abstractBounds.minX) * scaleX,
      y: worldMinY + (abstractCenter.y - abstractBounds.minY) * scaleY,
    };

    let classification: HexCellClassification = "empty";
    for (const priority of ["building", "water", "landcover"] as const) {
      const match = polygons.some((p) => p.kind === priority && pointInRing(worldPoint, p.rings[0]));
      if (match) {
        classification = priority;
        break;
      }
    }
    if (classification === "empty") {
      const onRoad = lines.some((line) =>
        line.some((point, i) => i > 0 && pointToSegmentDistance(worldPoint, line[i - 1], point) <= ROAD_HIT_RADIUS_METERS),
      );
      if (onRoad) classification = "road";
    }

    return { ...coord, classification };
  });

  fillSurroundedOpenCells(cells);

  const counts: Record<HexCellClassification, number> = { building: 0, water: 0, road: 0, landcover: 0, empty: 0 };
  for (const cell of cells) counts[cell.classification]++;

  const coverage = Object.fromEntries(
    Object.entries(counts).map(([key, count]) => [key, cells.length === 0 ? 0 : count / cells.length]),
  ) as Record<HexCellClassification, number>;

  return { radius: BASE_HEX_RADIUS, cells, coverage };
}
