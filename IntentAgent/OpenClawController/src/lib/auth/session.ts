import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAME = "openclaw-controller-session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type SessionCookie = {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: "lax";
    path: "/";
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
    name: SESSION_COOKIE_NAME,
    value,
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
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
