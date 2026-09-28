import { config } from "../../config.js";

export interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

let lastRequestAt = 0;

/** Respects Nominatim's usage policy: max 1 request/second, from the client. */
export async function searchPlaces(query: string): Promise<NominatimResult[]> {
  if (!query.trim()) return [];

  const wait = Math.max(0, 1000 - (Date.now() - lastRequestAt));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();

  const url = new URL(`${config.nominatimUrl}/search`);
  url.searchParams.set("format", "json");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "5");

  const response = await fetch(url.toString());
  if (!response.ok) return [];
  return (await response.json()) as NominatimResult[];
}
