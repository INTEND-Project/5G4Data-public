import { z } from "zod";

const tmfBaseUrlSchema = z
  .string()
  .trim()
  .url({ message: "Enter a valid HTTP or HTTPS URL." });

export function normalizeTmfBaseUrl(url: string): string {
  let normalized = url.trim().replace(/\/+$/, "");
  if (normalized.endsWith("/intent")) {
    normalized = normalized.slice(0, -"/intent".length).replace(/\/+$/, "");
  }
  return normalized;
}

export function tmfCreateIntentUrl(tmfBaseUrl: string): string {
  return `${normalizeTmfBaseUrl(tmfBaseUrl)}/intent`;
}

export function parseTmfBaseUrlInput(value: string): { ok: true; url: string } | { ok: false; error: string } {
  try {
    const parsed = tmfBaseUrlSchema.parse(value);
    return { ok: true, url: normalizeTmfBaseUrl(parsed) };
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? (error.issues[0]?.message ?? "Invalid URL.")
        : error instanceof Error
          ? error.message
          : "Invalid URL.";
    return { ok: false, error: message };
  }
}
