import type { LatLng } from "@blackout/shared";
import { config } from "../config.js";

export interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

export interface ReverseGeocodeResult {
  city: string | null;
  displayName: string;
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

/**
 * City/town label for the base-placement popover — not a building-level lookup, so it's
 * fine for this to go straight to Nominatim reverse rather than through Overpass is_in()/
 * pivot (see CLAUDE.md on why *that* lookup can't use Nominatim reverse).
 */
export async function reverseGeocode(position: LatLng): Promise<ReverseGeocodeResult | null> {
  await throttle();

  const url = new URL(`${config.nominatimUrl}/reverse`);
  url.searchParams.set("format", "json");
  url.searchParams.set("lat", String(position.lat));
  url.searchParams.set("lon", String(position.lng));
  url.searchParams.set("zoom", "10");

  const response = await fetch(url.toString());
  if (!response.ok) return null;
  const data = (await response.json()) as { display_name?: string; address?: Record<string, string> };
  const address = data.address ?? {};
  const city = address.city ?? address.town ?? address.village ?? address.hamlet ?? address.municipality ?? null;
  return { city, displayName: data.display_name ?? "" };
}
