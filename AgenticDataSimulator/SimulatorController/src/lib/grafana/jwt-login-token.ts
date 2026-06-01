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

export type GrafanaJwtOrgRole = "Viewer" | "Editor" | "Admin";

export type CreateGrafanaLoginTokenInput = {
  username: string;
  emailDomain?: string;
  secret: string;
  ttlSeconds?: number;
  nowMs?: number;
  /** Org role for main Grafana org (claim `role`). Omit for Viewer default on Grafana side. */
  orgRole?: GrafanaJwtOrgRole;
};

/** Comma-separated logins from GRAFANA_JWT_EDITOR_USERS (e.g. arneme,arne). */
export function parseGrafanaJwtEditorUsers(raw: string | undefined): Set<string> {
  const users = new Set<string>();
  if (!raw?.trim()) {
    return users;
  }
  for (const part of raw.split(",")) {
    const login = part.trim().toLowerCase();
    if (login) {
      users.add(login);
    }
  }
  return users;
}

export function resolveGrafanaJwtOrgRole(
  username: string,
  editorUsers: Set<string>,
): GrafanaJwtOrgRole | undefined {
  if (editorUsers.has(username.trim().toLowerCase())) {
    return "Editor";
  }
  return undefined;
}

export function createGrafanaLoginToken(input: CreateGrafanaLoginTokenInput): string {
  const username = input.username.trim();
  const nowMs = input.nowMs ?? Date.now();
  const ttlSeconds = input.ttlSeconds ?? 300;
  const emailDomain = input.emailDomain?.trim() || "simulator.local";

  const payload: Record<string, unknown> = {
    sub: username,
    email: grafanaEmailForLogin(username, emailDomain),
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor(nowMs / 1000) + ttlSeconds,
  };
  if (input.orgRole) {
    payload.role = input.orgRole;
  }

  return signHs256Jwt(payload, input.secret);
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
