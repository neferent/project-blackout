export const config = {
  apiUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8787",
  defaultCenter: {
    lat: Number(import.meta.env.VITE_DEFAULT_CENTER_LAT ?? 49.2827),
    lng: Number(import.meta.env.VITE_DEFAULT_CENTER_LNG ?? -123.1207),
  },
  // Kept out of the map style so the tile source can switch to self-hosted
  // Protomaps PMTiles later without touching layer code. This is a TileJSON
  // endpoint (OpenMapTiles schema), not a full style URL.
  tileSourceUrl: import.meta.env.VITE_TILE_SOURCE_URL ?? "https://tiles.openfreemap.org/planet",
  glyphsUrl: import.meta.env.VITE_GLYPHS_URL ?? "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  nominatimUrl: import.meta.env.VITE_NOMINATIM_URL ?? "https://nominatim.openstreetmap.org",
};
