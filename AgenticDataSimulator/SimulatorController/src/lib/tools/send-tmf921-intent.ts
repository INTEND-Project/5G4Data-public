import { tmfCreateIntentUrl } from "@/lib/tools/parse-tmf-base-url";
import type { Tmf921CreateIntentBody } from "@/lib/tools/build-tmf921-create-intent";

const SEND_TIMEOUT_MS = 30_000;

export type Tmf921SendResult = {
  status: number;
  body: unknown;
  targetUrl: string;
};

export async function sendTmf921Intent(
  tmfBaseUrl: string,
  payload: Tmf921CreateIntentBody,
): Promise<Tmf921SendResult> {
  const targetUrl = tmfCreateIntentUrl(tmfBaseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Tool request timed out after ${SEND_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    /* keep raw text */
  }

  return { status: response.status, body, targetUrl };
}
