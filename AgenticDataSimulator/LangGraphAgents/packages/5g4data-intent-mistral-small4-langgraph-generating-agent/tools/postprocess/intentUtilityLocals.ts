/** Intent-scoped coordination utility local names (avoids cross-run GraphDB IRI collisions). */

export const INTENT_UUID_HEX_LEN = 32;

export function extractIntentLocalFromTurtle(text: string): string | null {
  const full = text.match(/\bdata5g:(I[0-9a-fA-F]{32})\b/);
  if (full?.[1]) return full[1];
  const short = text.match(/\bdata5g:(I[0-9a-fA-F]+)\s+a\s+icm:Intent\b/i);
  return short?.[1] ?? null;
}

/** Full 32-hex UUID body from an intent local (`I` + uuid), or null when not canonical. */
export function intentUtilityUuid(intentLocal: string): string | null {
  const body = intentLocal.startsWith("I") ? intentLocal.slice(1) : intentLocal;
  if (!/^[0-9a-f]{32}$/i.test(body)) return null;
  return body.toLowerCase();
}

export interface CoordinationUtilityLocals {
  uInfo: string;
  uProfile: string;
  utilityFnLocal: (profile: "symmetric" | "weighted") => string;
}

const LEGACY_UTILITY_LOCALS: CoordinationUtilityLocals = {
  uInfo: "U_coord",
  uProfile: "UP_coord",
  utilityFnLocal: (profile) => `utilityFn_${profile}`,
};

export function resolveCoordinationUtilityLocals(text: string): CoordinationUtilityLocals {
  const intentLocal = extractIntentLocalFromTurtle(text);
  if (!intentLocal) return LEGACY_UTILITY_LOCALS;
  const uuid = intentUtilityUuid(intentLocal);
  if (!uuid) return LEGACY_UTILITY_LOCALS;
  return {
    uInfo: `UI${uuid}`,
    uProfile: `UP${uuid}`,
    utilityFnLocal: (_profile) => `UN${uuid}`,
  };
}

export function isCoordinationUtilityInfoLocal(local: string): boolean {
  return (
    local === "U_coord" ||
    /^UI[0-9a-f]{32}$/i.test(local) ||
    /^U_coord_[0-9a-f]+$/i.test(local)
  );
}

export function isCoordinationUtilityProfileLocal(local: string): boolean {
  return (
    local === "UP_coord" ||
    /^UP[0-9a-f]{32}$/i.test(local) ||
    /^UP_coord_[0-9a-f]+$/i.test(local)
  );
}

export function isCoordinationUtilityFunctionLocal(local: string): boolean {
  return /^UN[0-9a-f]{32}$/i.test(local) || local.startsWith("utilityFn_");
}

export const UTILITY_SUBJECT_LOCAL_PATTERN =
  String.raw`(?:UI[0-9a-fA-F]{32}|UP[0-9a-fA-F]{32}|UN[0-9a-fA-F]{32}|U_coord(?:_[0-9a-fA-F]+)?|UP_coord(?:_[0-9a-fA-F]+)?|utilityFn_[A-Za-z0-9_]+|U_arg_[A-Za-z0-9_-]+)`;

const UTILITY_SUBJECT_LOCAL_RE = new RegExp(`^${UTILITY_SUBJECT_LOCAL_PATTERN}$`, "i");

export function isUtilitySubjectLocal(local: string): boolean {
  return UTILITY_SUBJECT_LOCAL_RE.test(local);
}

/** Match draft `ut:utility` links for legacy and intent-scoped utility information locals. */
export const UTILITY_INFO_LINK_LOCAL_PATTERN =
  String.raw`(?:U_coord(?:_[0-9a-fA-F]+)?|UI[0-9a-fA-F]{32})`;
