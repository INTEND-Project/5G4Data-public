export type FetchAgentCardResult =
  | { ok: true; rpcUrl: string; card: Record<string, unknown> }
  | { ok: false; message: string };

export async function fetchAgentRpcUrl(
  wellKnownURI: string,
  authHeaders: Record<string, string>,
): Promise<FetchAgentCardResult> {
  let response: Response;
  try {
    response = await fetch(wellKnownURI, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...authHeaders,
      },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    return {
      ok: false,
      message: `Failed to fetch agent card: ${String(err)}`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      message: `Agent card GET failed (${response.status}).`,
    };
  }

  let card: unknown;
  try {
    card = await response.json();
  } catch {
    return { ok: false, message: "Agent card response was not JSON." };
  }

  if (!card || typeof card !== "object") {
    return { ok: false, message: "Agent card payload invalid." };
  }

  const cardRecord = card as Record<string, unknown>;
  const url = cardRecord.url;
  if (typeof url !== "string" || !url.length) {
    return { ok: false, message: "Agent card missing string field url." };
  }

  return { ok: true, rpcUrl: url, card: cardRecord };
}
