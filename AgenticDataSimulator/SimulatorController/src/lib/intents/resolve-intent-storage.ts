import type { ObservationStorageType } from "@/lib/observation-storage";

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

export function resolveIntentStorage(input: {
  intentTurtle: string | null;
  inPrometheus: boolean;
}): ObservationStorageType {
  const fromTurtle = input.intentTurtle ? parseStorageFromIntentTurtle(input.intentTurtle) : null;
  if (fromTurtle) {
    return fromTurtle;
  }

  if (input.inPrometheus) {
    return "prometheus";
  }

  return "graphdb";
}
