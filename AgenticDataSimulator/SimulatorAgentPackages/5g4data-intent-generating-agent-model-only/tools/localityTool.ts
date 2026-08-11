export interface Coordinates {
  lat: number;
  lon: number;
}

/** Runtime-context tag emitted by CapabilityRouter for NE place grounding. */
export const NETWORK_GEO_CONTEXT_TAG = "[Network expectation geographic context]";

const NON_PLACE_PHRASE =
  /^(?:a|an|the|this|that|my|our|order|order to)\b|^(?:a\s+)?(?:data\s*cent(?:er|re)|sustainable|manner|deployment|network|slice|workload|model|llm)\b/i;

/**
 * Extract a place phrase from NL for geocoding.
 * Supports near/close to/around/at/in; filters obvious non-place fillers.
 */
export function extractLocalityPhrase(userText: string): string | null {
  const patterns = [
    /\bclose\s+to\s+([^,\n.]+?)(?=\s+with\b|\s+and\b|\s+for\b|\s+in\s+a\b|$)/i,
    /\b(?:near|around|at)\s+([^,\n.]+?)(?=\s+with\b|\s+and\b|\s+for\b|\s+in\s+a\b|$)/i,
    // Capitalized place: "in Tromsø", "in Bodø/Norway"
    /\bin\s+([A-ZÆØÅ][\wÆØÅæøå\-]+(?:\s*\/\s*[A-ZÆØÅ][\wÆØÅæøå\-]+)?)/,
    // Common Nordic place names even when lowercased
    /\bin\s+(troms[oø]|bod[oø]|oslo|bergen|stavanger|trondheim|norway)\b/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(userText);
    if (!match) continue;
    const phrase = cleanPlacePhrase(match[1] ?? "");
    if (phrase && !NON_PLACE_PHRASE.test(phrase)) return phrase;
  }
  return null;
}

function cleanPlacePhrase(raw: string): string {
  return raw
    .trim()
    .split("/")[0]
    ?.trim()
    .replace(/\s+with\b.*$/i, "")
    .replace(/\s+and\b.*$/i, "")
    .replace(/[.,;:!?]+$/g, "")
    .trim() ?? "";
}

export async function geocodePlace(place: string): Promise<Coordinates | null> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", place);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    const response = await fetch(url, {
      headers: { "User-Agent": "simulator-agent/0.1" }
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

/** Build the runtime-context block the model (and post-step) should trust for NE WKT. */
export function formatNetworkGeoContextBlock(place: string, wkt: string): string {
  return (
    `${NETWORK_GEO_CONTEXT_TAG}\n` +
    `Place: ${place}\n` +
    `Use dedicated network context with data5g:appliesToRegion and geo:asWKT.\n` +
    `Copy this literal exactly for geo:asWKT (do not reuse few-shot coordinates):\n` +
    `"${wkt}"^^geo:wktLiteral`
  );
}

/** WKT POLYGON in Turtle may be POLYGON((…)) or pretty-printed POLYGON( (…) ). */
const POLYGON_WKT_CAPTURE = String.raw`((?:POLYGON|polygon)\s*\(\s*\([^"]+\)\s*\))`;

/** Parse grounded POLYGON WKT from runtime context, if present. */
export function parseGroundedRegionWktFromRuntimeContext(runtimeContext: string): string | null {
  if (!runtimeContext.includes(NETWORK_GEO_CONTEXT_TAG)) return null;
  const match = runtimeContext.match(new RegExp(`"${POLYGON_WKT_CAPTURE}"\\^\\^geo:wktLiteral`, "i"));
  return match?.[1]?.trim() ?? null;
}

/**
 * Overwrite every geo:asWKT POLYGON literal in Turtle with the grounded WKT.
 * Returns original turtle when no POLYGON literals are present.
 */
export function applyGroundedRegionWktToTurtle(turtle: string, groundedWkt: string): string {
  if (!groundedWkt.trim()) return turtle;
  const replaced = turtle.replace(
    new RegExp(`geo:asWKT\\s+"${POLYGON_WKT_CAPTURE}"\\s*\\^\\^geo:wktLiteral`, "gi"),
    `geo:asWKT "${groundedWkt}"^^geo:wktLiteral`
  );
  return replaced;
}
