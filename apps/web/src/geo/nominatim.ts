import type { LatLng } from "@blackout/shared";
import { config } from "../config.js";

export interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

export interface NominatimReverseResult {
  display_name: string;
  /**
   * Broad OSM category: "building", "shop", "amenity", "highway", ...
   * Called `category` in jsonv2 responses (Nominatim avoids the `class` name
   * since it's a reserved word in several client languages).
   */
  category: string;
  /** Specific value within that category: "house", "supermarket", "residential", ... */
  type: string;
  name?: string;
}

let lastRequestAt = 0;

/** Respects Nominatim's usage policy: max 1 request/second, from the client. */
async function throttle(): Promise<void> {
  const wait = Math.max(0, 1000 - (Date.now() - lastRequestAt));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

export async function searchPlaces(query: string): Promise<NominatimResult[]> {
  if (!query.trim()) return [];
  await throttle();

  const url = new URL(`${config.nominatimUrl}/search`);
  url.searchParams.set("format", "json");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "5");

  const response = await fetch(url.toString());
  if (!response.ok) return [];
  return (await response.json()) as NominatimResult[];
}

async function reverseGeocodeRaw(position: LatLng, layer?: string): Promise<NominatimReverseResult | null> {
  const url = new URL(`${config.nominatimUrl}/reverse`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(position.lat));
  url.searchParams.set("lon", String(position.lng));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "0");
  if (layer) url.searchParams.set("layer", layer);

  const response = await fetch(url.toString());
  if (!response.ok) return null;
  const body = await response.json();
  if (!body || body.error) return null;
  return body as NominatimReverseResult;
}

/**
 * What's at a point — used to tell the player what building/place they've
 * clicked on. Restricted to the "address" layer first: the unrestricted
 * reverse endpoint often returns the nearest incidental POI node (a loading
 * dock, a pharmacy counter, ...) instead of the actual building/shop it sits
 * inside, especially for big-box stores mapped with several sub-features.
 * Falls back to an unrestricted lookup for points with no addressed feature
 * (open land, parks, ...).
 */
export async function reverseGeocode(position: LatLng): Promise<NominatimReverseResult | null> {
  await throttle();
  const addressResult = await reverseGeocodeRaw(position, "address");
  if (addressResult) return addressResult;

  await throttle();
  return reverseGeocodeRaw(position);
}

function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A short human-readable label for what was clicked, e.g. "House", "Supermarket (shop)". */
export function describePlace(result: NominatimReverseResult): string {
  if (!result.category || !result.type) return "Unknown";
  if (result.category === "building") {
    if (!result.type || result.type === "yes") return "Building (unclassified)";
    return humanize(result.type);
  }
  return `${humanize(result.type)} (${humanize(result.category)})`;
}
