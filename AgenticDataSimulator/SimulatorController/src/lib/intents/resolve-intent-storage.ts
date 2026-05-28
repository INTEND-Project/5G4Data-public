import type { ObservationStorageType } from "@/lib/observation-storage";

/**
 * Legacy helper for compact intent Turtle used in agent tests/docs.
 * Runtime storage for the Controller UI is resolved from `intent-reports-metadata`
 * (`data5g:hasQuery`) via {@link resolveObservationStorageFromMetadata}.
 */
const DESTINATION_BLOCK =
  /icm:reportDestinations\s*\[\s*a\s+rdfs:Container\s*;\s*rdfs:member\s+data5g:(prometheus|graphdb)\s*\]\s*;/gi;

export function parseStorageFromIntentTurtle(turtle: string): ObservationStorageType | null {
  const matches = [...turtle.matchAll(DESTINATION_BLOCK)];
  if (matches.length === 0) {
    return null;
  }

  const members = matches.map((match) => match[1]?.toLowerCase()).filter(Boolean);
  if (members.some((member) => member === "prometheus")) {
    return "prometheus";
  }

  if (members.some((member) => member === "graphdb")) {
    return "graphdb";
  }

  return null;
}
