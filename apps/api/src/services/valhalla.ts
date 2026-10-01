import { haversineKm, type LatLng, type LineStringGeometry } from "@blackout/shared";

const VALHALLA_URL = process.env.VALHALLA_URL ?? "http://localhost:8002";

/**
 * Below this gap, treat the network-snapped point as "close enough" and skip
 * adding a straight connector segment — avoids visible jitter from polyline6's
 * ~1m encoding precision.
 */
const LAST_MILE_THRESHOLD_KM = 0.003;

interface ValhallaTripResponse {
  trip: {
    legs: { shape: string }[];
    summary: { length: number }; // kilometers
  };
}

/** Decodes Valhalla's polyline6-encoded shape into [lng, lat] pairs. */
function decodePolyline6(encoded: string): [number, number][] {
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const factor = 1e6;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push([lng / factor, lat / factor]);
  }

  return coordinates;
}

export interface PedestrianRoute {
  route: LineStringGeometry;
  distanceKm: number;
}

export async function requestPedestrianRoute(
  origin: LatLng,
  destination: LatLng,
  excludePolygons?: LatLng[][],
): Promise<PedestrianRoute> {
  const response = await fetch(`${VALHALLA_URL}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locations: [
        { lat: origin.lat, lon: origin.lng },
        { lat: destination.lat, lon: destination.lng },
      ],
      costing: "pedestrian",
      units: "kilometers",
      // Valhalla drops any graph edge that intersects one of these rings from
      // routing consideration — [lon, lat] order, unlike `locations` above.
      ...(excludePolygons?.length
        ? { exclude_polygons: excludePolygons.map((ring) => ring.map((p) => [p.lng, p.lat])) }
        : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Valhalla routing failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as ValhallaTripResponse;
  const shape = body.trip.legs.map((leg) => leg.shape).join("");

  let coordinates = decodePolyline6(shape);
  let distanceKm = body.trip.summary.length;

  // Valhalla snaps both ends to the nearest routable edge (a road or path) —
  // buildings and other off-network points aren't part of the pedestrian
  // graph. Extend the route with a straight "last mile" segment out to the
  // actual requested point so travel visibly reaches the door, not just the
  // street outside it.
  const snappedOrigin: LatLng = { lat: coordinates[0][1], lng: coordinates[0][0] };
  const originGapKm = haversineKm(origin, snappedOrigin);
  if (originGapKm > LAST_MILE_THRESHOLD_KM) {
    coordinates = [[origin.lng, origin.lat], ...coordinates];
    distanceKm += originGapKm;
  }

  const snappedDestination: LatLng = {
    lat: coordinates[coordinates.length - 1][1],
    lng: coordinates[coordinates.length - 1][0],
  };
  const destinationGapKm = haversineKm(destination, snappedDestination);
  if (destinationGapKm > LAST_MILE_THRESHOLD_KM) {
    coordinates = [...coordinates, [destination.lng, destination.lat]];
    distanceKm += destinationGapKm;
  }

  return {
    route: { type: "LineString", coordinates },
    distanceKm,
  };
}
