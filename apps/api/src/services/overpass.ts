import { haversineKm, type BuildingInZone, type BuildingLookup, type LatLng } from "@blackout/shared";

const OVERPASS_URL = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
/** Self-imposed throttle — be a good citizen on the free public instance. */
const MIN_REQUEST_INTERVAL_MS = 1500;
/** Wide enough to cover a big-box store's footprint even when clicked near an edge. */
const SEARCH_RADIUS_M = 120;
/** A successful response normally lands in 1-2s; this bounds a stuck request without
 * itself becoming the dominant source of latency when stacked with the retry below. */
const REQUEST_TIMEOUT_MS = 5000;
/**
 * A `poly` area query (queryOverpassBuildingsInZone) returns every building
 * in the zone rather than a handful near one point, and was observed taking
 * 8-10s+ on the public instance — REQUEST_TIMEOUT_MS is too tight for it and
 * was silently discarding real results as timeouts.
 */
const ZONE_QUERY_TIMEOUT_MS = 20000;

let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

interface OverpassMember {
  type: "node" | "way" | "relation";
  ref: number;
  role: string;
  geometry?: { lat: number; lon: number }[];
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  members?: OverpassMember[];
  tags?: Record<string, string>;
}

/** Ray-casting point-in-polygon test against a single ring. */
function pointInRing(point: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng;
    const yi = ring[i].lat;
    const xj = ring[j].lng;
    const yj = ring[j].lat;
    const intersects = yi > point.lat !== yj > point.lat && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** True if the point falls inside any of the building's outer rings. */
function pointInOutline(point: LatLng, outline: LatLng[][]): boolean {
  return outline.some((ring) => pointInRing(point, ring));
}

function centroid(outline: LatLng[][]): LatLng {
  const points = outline.flat();
  return {
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
    lng: points.reduce((sum, p) => sum + p.lng, 0) / points.length,
  };
}

/** OSM allows semicolon-separated multi-values on a single tag (e.g. `shop=greenhouse;retail`). */
function humanize(value: string): string {
  return value
    .split(";")
    .map((part) => {
      const spaced = part.trim().replace(/_/g, " ");
      return spaced.charAt(0).toUpperCase() + spaced.slice(1);
    })
    .join(", ");
}

/**
 * Shop/amenity kinds prominent enough to be "the" identity of a building —
 * used to recognize a big-box anchor store mapped only as a point inside a
 * building polygon that itself carries a generic site label instead of the
 * brand name (see GENERIC_BUILDING_NAME_PATTERN).
 */
const ANCHOR_SHOP_KINDS = new Set(["department_store", "supermarket", "mall", "hypermarket", "variety_store", "wholesale"]);

/**
 * Matches generic per-unit site labels ("Building A", "Unit 3", "Pad B") that
 * North American strip-mall/power-center mappers commonly use in place of a
 * brand name on the building polygon itself — verified against live OSM data
 * (a Walmart Supercenter mapped as "Building A" with the brand only present
 * as a separate `shop=department_store` point inside it).
 */
const GENERIC_BUILDING_NAME_PATTERN = /^(building|unit|pad)\s+[a-z0-9]+$/i;

function elementPoint(e: OverpassElement): LatLng | null {
  if (e.type === "node" && e.lat !== undefined && e.lon !== undefined) return { lat: e.lat, lng: e.lon };
  if (e.center) return { lat: e.center.lat, lng: e.center.lon };
  return null;
}

/**
 * One retry on a *fast* transient failure (a 429/504 response, which the
 * public instance returns quickly when it's rejecting/overloaded) — treating
 * that the same as "genuinely no building here" would wrongly fall back to
 * Nominatim's inferior nearest-point reverse lookup for a real building.
 * Does NOT retry after our own request timed out: that already means
 * Overpass is stuck, and stacking a second full timeout on top would only
 * double the worst-case latency instead of recovering anything.
 */
async function fetchOverpassElements(
  query: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
  attempt = 1,
): Promise<OverpassElement[] | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      // Overpass's Apache config 406s requests with no/generic User-Agent
      // (Node's fetch sends none by default; browsers set one implicitly).
      headers: { Accept: "application/json", "User-Agent": "project-blackout-poc/1.0" },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!response.ok) {
      if (attempt >= 2) return null;
      await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS));
      return fetchOverpassElements(query, timeoutMs, attempt + 1);
    }
    // Overpass returns an XML error body (not JSON) on rate-limit/server errors.
    const body = JSON.parse(await response.text()) as { elements?: OverpassElement[] };
    return body.elements ?? [];
  } catch {
    return null; // aborted (timeout) or a network error — don't compound it with a second wait
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Finds the building polygon at a clicked point, plus every other
 * shop/amenity feature whose point falls inside that same polygon — so a
 * store's separately-mapped sub-departments (pharmacy, garden center, ...)
 * show up as *contents* of the store, not as the answer to "what is this".
 *
 * Queries both plain ways and multipolygon relations tagged `building`: big
 * stores with complex or detached roof shapes are frequently mapped as
 * relations, which a way-only query silently misses.
 *
 * Uses a cheap radius search (`around`) rather than is_in()/pivot, which
 * walks the entire administrative hierarchy and was observed taking 5-10s+
 * on the public Overpass instance. Containment is verified server-side with
 * a point-in-polygon test against the actual building geometry.
 */
export async function queryOverpassBuilding(position: LatLng): Promise<BuildingLookup | null> {
  await throttle();

  const { lat, lng } = position;
  const query = `[out:json][timeout:10];
(
  way(around:${SEARCH_RADIUS_M},${lat},${lng})[building];
  relation(around:${SEARCH_RADIUS_M},${lat},${lng})[building];
);
out geom;
(
  node(around:${SEARCH_RADIUS_M},${lat},${lng})[shop];
  node(around:${SEARCH_RADIUS_M},${lat},${lng})[amenity];
  way(around:${SEARCH_RADIUS_M},${lat},${lng})[shop];
  way(around:${SEARCH_RADIUS_M},${lat},${lng})[amenity];
);
out center tags;`;

  const elements = await fetchOverpassElements(query);
  if (elements === null) return null;

  function outlineOf(e: OverpassElement): LatLng[][] | null {
    if (e.type === "way" && e.geometry) return [e.geometry.map((g) => ({ lat: g.lat, lng: g.lon }))];
    if (e.type === "relation" && e.members) {
      const outerRings = e.members
        .filter((m) => m.role === "outer" && m.geometry)
        .map((m) => m.geometry!.map((g) => ({ lat: g.lat, lng: g.lon })));
      return outerRings.length > 0 ? outerRings : null;
    }
    return null;
  }

  const buildings = elements
    .filter((e) => Boolean(e.tags?.building))
    .map((e) => ({ element: e, outline: outlineOf(e) }))
    .filter((b): b is { element: OverpassElement; outline: LatLng[][] } => b.outline !== null);

  if (buildings.length === 0) return null;

  const containing = buildings.find((b) => pointInOutline(position, b.outline));
  const chosen =
    containing ??
    buildings.reduce((closest, b) =>
      haversineKm(position, centroid(b.outline)) < haversineKm(position, centroid(closest.outline)) ? b : closest,
    );

  const enclosed = elements
    .filter((e) => !(e.type === chosen.element.type && e.id === chosen.element.id) && (e.tags?.shop || e.tags?.amenity))
    .map((e) => ({ point: elementPoint(e), tags: e.tags! }))
    .filter((e): e is { point: LatLng; tags: Record<string, string> } => e.point !== null && pointInOutline(e.point, chosen.outline));

  // The building polygon itself is sometimes a generic per-unit site label
  // ("Building A") rather than the brand name, with the brand only present
  // as an anchor-shop point inside it — adopt that point's identity instead.
  const buildingName = chosen.element.tags?.name;
  const useAnchorIdentity = !buildingName || GENERIC_BUILDING_NAME_PATTERN.test(buildingName);
  const anchor = useAnchorIdentity ? enclosed.find((e) => e.tags.name && ANCHOR_SHOP_KINDS.has(e.tags.shop ?? "")) : undefined;

  const contains = enclosed
    .filter((e) => e !== anchor)
    .map((e) => ({
      name: e.tags.name ?? humanize(e.tags.shop ?? e.tags.amenity ?? "place"),
      kind: humanize(e.tags.shop ?? e.tags.amenity ?? ""),
    }))
    .filter((item, index, all) => all.findIndex((x) => x.name === item.name) === index);

  return {
    osmType: chosen.element.type as "way" | "relation",
    osmId: String(chosen.element.id),
    name: anchor?.tags.name ?? chosen.element.tags?.name,
    shop: anchor?.tags.shop ?? chosen.element.tags?.shop,
    amenity: anchor ? undefined : chosen.element.tags?.amenity,
    building: chosen.element.tags?.building,
    outline: chosen.outline,
    contains,
    connectedToGrid: true,
  };
}

/**
 * A wide viewport (zoomed far out, or a fast long-distance pan) makes for a
 * much heavier bbox query than the default REQUEST_TIMEOUT_MS assumes —
 * observed silently swallowing real transmission lines as "no results" when
 * the request got aborted before Overpass finished. Same reasoning as
 * ZONE_QUERY_TIMEOUT_MS above.
 */
const POWER_QUERY_TIMEOUT_MS = 20000;

/** A `power=line` way, still carrying its OSM id — see powerInfrastructureCache.ts, which
 * upserts by it so re-fetching an overlapping area doesn't duplicate rows. */
export interface PowerLineFeature {
  osmId: string;
  points: LatLng[];
}

/** A `power=tower` node, likewise carrying its OSM id for cache upserts. */
export interface PowerTowerFeature {
  osmId: string;
  point: LatLng;
}

/**
 * High-voltage transmission lines and their lattice/monopole towers within a
 * viewport bbox. Deliberately excludes `power=minor_line` (low-voltage
 * distribution wiring run along streets on wooden `power=pole` supports) —
 * only `power=line` (major transmission) and `power=tower` (the metal
 * support structures for it) are queried.
 *
 * Returns null (not an empty result) when the Overpass query itself failed
 * or timed out, so callers can tell "genuinely nothing here" apart from
 * "couldn't find out" and choose not to blank out already-rendered data.
 */
export async function queryOverpassPowerInfrastructure(
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
): Promise<{ lines: PowerLineFeature[]; towers: PowerTowerFeature[] } | null> {
  await throttle();

  const bbox = `${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng}`;
  const query = `[out:json][timeout:18];
(
  way["power"="line"](${bbox});
  node["power"="tower"](${bbox});
);
out geom;`;

  const elements = await fetchOverpassElements(query, POWER_QUERY_TIMEOUT_MS);
  if (elements === null) return null;

  const lines = elements
    .filter((e) => e.type === "way" && e.tags?.power === "line" && e.geometry)
    .map((e) => ({ osmId: String(e.id), points: e.geometry!.map((g) => ({ lat: g.lat, lng: g.lon })) }));

  const towers = elements
    .filter((e) => e.type === "node" && e.tags?.power === "tower" && e.lat !== undefined && e.lon !== undefined)
    .map((e) => ({ osmId: String(e.id), point: { lat: e.lat!, lng: e.lon! } }));

  return { lines, towers };
}

/** height/building:levels (3m per level, a common OSM-rendering convention) tags, if present. */
function tagHeightMeters(tags: Record<string, string> | undefined): number | undefined {
  if (!tags) return undefined;
  const height = tags.height ? parseFloat(tags.height) : NaN;
  if (!Number.isNaN(height)) return height;
  const levels = tags["building:levels"] ? parseFloat(tags["building:levels"]) : NaN;
  if (!Number.isNaN(levels)) return levels * 3;
  return undefined;
}

/**
 * Every building (plain ways only — multipolygon relations aren't queryable
 * by Overpass's `around`/`poly` filters) within `radiusMeters` of `zone`'s
 * boundary. Used for danger-zone building highlighting: unlike querying
 * MapLibre's already-rendered vector tiles, this reads full-fidelity OSM
 * geometry directly, so results don't shift with zoom/tile-clipping and
 * don't depend on the zone's tiles already being on screen.
 *
 * Uses Overpass's `around` filter given the zone's ring as a coordinate
 * list — distance to that boundary line, not a true buffered-polygon
 * distance. For a small, roughly-convex zone like the POC's test zone this
 * is a very close approximation (only a deep interior point more than
 * `radiusMeters` from every edge would be missed, which doesn't arise at
 * this zone's size) and needs no polygon-offset geometry.
 */
export async function queryOverpassBuildingsInZone(zone: LatLng[], radiusMeters: number): Promise<BuildingInZone[]> {
  await throttle();

  const boundary = zone.map((p) => `${p.lat},${p.lng}`).join(",");
  const query = `[out:json][timeout:15];
way(around:${radiusMeters},${boundary})[building];
out geom;`;

  const elements = await fetchOverpassElements(query, ZONE_QUERY_TIMEOUT_MS);
  if (elements === null) return [];

  return elements
    .filter((e) => e.type === "way" && e.geometry)
    .map((e) => ({
      outline: e.geometry!.map((g) => ({ lat: g.lat, lng: g.lon })),
      height: tagHeightMeters(e.tags),
    }));
}
