import { z } from "zod";

import { loadAppEnv } from "@/lib/env";
import { normalizeGraphDbBaseUrl } from "@/lib/graphdb/urls";

const graphDbBaseUrlSchema = z
  .string()
  .trim()
  .url({ message: "Enter a valid HTTP or HTTPS URL." });

/** Resolve GraphDB API base URL: user override, else server default from env. */
export function resolveGraphDbBaseUrl(override?: string | null): string {
  const trimmed = override?.trim();
  if (trimmed) {
    return normalizeGraphDbBaseUrl(graphDbBaseUrlSchema.parse(trimmed));
  }

  const env = loadAppEnv(process.env);
  return normalizeGraphDbBaseUrl(env.graphDbBaseUrl);
}

export function parseGraphDbBaseUrlInput(value: string): {
  ok: true;
  url: string;
} | {
  ok: false;
  error: string;
} {
  try {
    return { ok: true, url: resolveGraphDbBaseUrl(value) };
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
