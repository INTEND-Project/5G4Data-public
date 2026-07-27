import { createHash, randomBytes } from "node:crypto";

import { APP_BASE_PATH } from "@/lib/app-paths";

/** Legacy cookie name (path `/`). Kept for one release so existing sessions still work. */
export const SESSION_COOKIE_NAME = "simulator-controller-session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/** Per-instance cookie name so prod and dev on the same host do not overwrite each other. */
export function getSessionCookieName(basePath = APP_BASE_PATH): string {
  const slug = basePath.replace(/^\/+|\/+$/g, "").replace(/\//g, "-");

  if (!slug) {
    return SESSION_COOKIE_NAME;
  }

  return `${SESSION_COOKIE_NAME}-${slug}`;
}

export function sessionCookiePath(basePath = APP_BASE_PATH): string {
  return basePath || "/";
}

export type SessionCookie = {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: "lax";
    path: string;
    secure: boolean;
    maxAge: number;
  };
};

export function createSessionToken() {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionExpiry(now = new Date()) {
  return new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
}

export function createSessionCookie(value: string, secure: boolean): SessionCookie {
  return {
    name: getSessionCookieName(),
    value,
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: sessionCookiePath(),
      secure,
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
  };
}

export function createClearedSessionCookie(secure: boolean): SessionCookie {
  return {
    ...createSessionCookie("", secure),
    options: {
      ...createSessionCookie("", secure).options,
      maxAge: 0,
    },
  };
}

/** Clears the legacy host-wide session cookie after migrating to per-base-path cookies. */
export function createLegacyClearedSessionCookie(secure: boolean): SessionCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: "",
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure,
      maxAge: 0,
    },
  };
}
