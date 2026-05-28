import { createHmac } from "node:crypto";

import { grafanaEmailForLogin } from "@/lib/grafana/provision-user";

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signHs256Jwt(payload: Record<string, unknown>, secret: string): string {
  const header = base64UrlEncode(
    JSON.stringify({ alg: "HS256", typ: "JWT", kid: "simulator-controller" }),
  );
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${header}.${body}.${signature}`;
}

export type CreateGrafanaLoginTokenInput = {
  username: string;
  emailDomain?: string;
  secret: string;
  ttlSeconds?: number;
  nowMs?: number;
};

export function createGrafanaLoginToken(input: CreateGrafanaLoginTokenInput): string {
  const username = input.username.trim();
  const nowMs = input.nowMs ?? Date.now();
  const ttlSeconds = input.ttlSeconds ?? 300;
  const emailDomain = input.emailDomain?.trim() || "simulator.local";

  return signHs256Jwt(
    {
      sub: username,
      email: grafanaEmailForLogin(username, emailDomain),
      iat: Math.floor(nowMs / 1000),
      exp: Math.floor(nowMs / 1000) + ttlSeconds,
    },
    input.secret,
  );
}

export function buildHs256Jwks(secret: string, kid = "simulator-controller"): string {
  return JSON.stringify(
    {
      keys: [
        {
          kty: "oct",
          kid,
          alg: "HS256",
          use: "sig",
          k: base64UrlEncode(secret),
        },
      ],
    },
    null,
    2,
  );
}
