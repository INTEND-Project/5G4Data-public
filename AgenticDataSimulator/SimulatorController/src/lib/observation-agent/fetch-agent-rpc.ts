export async function fetchAgentRpcUrlFromWellKnown(
  wellKnownURI: string,
  authHeaders: Record<string, string>,
): Promise<
  | { ok: true; rpcUrl: string }
  | { ok: false; message: string }
> {
  let response: Response;
  try {
    response = await fetch(wellKnownURI, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...authHeaders,
      },
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

  const url = (card as Record<string, unknown>).url;
  if (typeof url !== "string" || !url.length) {
    return { ok: false, message: "Agent card missing string field url." };
  }

  return { ok: true, rpcUrl: url };
}
