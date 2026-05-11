function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildRepositoryId(domain: string, displayName: string) {
  return `${slugify(domain)}-${slugify(displayName)}`;
}

export function buildGraphIri(domain: string, displayName: string) {
  return `urn:intend:kg:${slugify(domain)}:${slugify(displayName)}`;
}
