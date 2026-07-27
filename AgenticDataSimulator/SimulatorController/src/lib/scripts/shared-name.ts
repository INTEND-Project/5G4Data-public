export const SHARED_PREFIX = "shared-";

export function baseNameForShare(sourceName: string): string {
  const trimmed = sourceName.trim();
  if (trimmed.startsWith(SHARED_PREFIX)) {
    return trimmed.slice(SHARED_PREFIX.length).trim();
  }
  return trimmed;
}

export function defaultSharedNameSuffix(sourceName: string): string {
  return baseNameForShare(sourceName);
}

export function buildSharedScriptName(suffix: string): string {
  return `${SHARED_PREFIX}${suffix.trim()}`;
}

export function normalizeSharedScriptName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return SHARED_PREFIX;
  }
  if (trimmed.startsWith(SHARED_PREFIX)) {
    return trimmed;
  }
  return buildSharedScriptName(trimmed);
}

export function sharedNameSuffixFromInput(input: {
  name?: string;
  nameSuffix?: string;
}): string | null {
  if (typeof input.nameSuffix === "string") {
    const suffix = input.nameSuffix.trim();
    return suffix.length > 0 ? suffix : null;
  }

  if (typeof input.name === "string") {
    const suffix = baseNameForShare(input.name);
    return suffix.length > 0 ? suffix : null;
  }

  return null;
}
