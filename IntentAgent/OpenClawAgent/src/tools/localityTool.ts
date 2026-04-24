export interface Coordinates {
  lat: number;
  lon: number;
}

export function extractLocalityPhrase(userText: string): string | null {
  const patterns = [/\bnear\s+([^,\n]+)/i, /\bclose to\s+([^,\n]+)/i];
  for (const pattern of patterns) {
    const match = pattern.exec(userText);
    if (!match) continue;
    const phrase = match[1]?.trim().split("/")[0]?.trim();
    if (phrase) return phrase;
  }
  return null;
}

export async function geocodePlace(place: string): Promise<Coordinates | null> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", place);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    const response = await fetch(url, {
      headers: { "User-Agent": "openclaw-agent/0.1" }
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as Array<{ lat: string; lon: string }>;
    if (!Array.isArray(payload) || payload.length === 0) return null;
    const first = payload[0];
    if (!first) return null;
    return { lat: Number(first.lat), lon: Number(first.lon) };
  } catch {
    return null;
  }
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radiusKm * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function bboxPolygonWkt(lat: number, lon: number, deltaDeg = 0.06): string {
  const west = lon - deltaDeg;
  const east = lon + deltaDeg;
  const south = lat - deltaDeg;
  const north = lat + deltaDeg;
  const ring: Array<[number, number]> = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south]
  ];
  const coords = ring.map(([lo, la]) => `${lo.toFixed(6)} ${la.toFixed(6)}`).join(",");
  return `POLYGON((${coords}))`;
}
