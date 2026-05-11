import type { User } from "@prisma/client";
type CookieReader = {
  get(name: string): { value: string } | undefined;
};


import { db } from "@/lib/db";
import { hashSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";

function parseCookieHeader(cookieHeader: string | null) {
  if (!cookieHeader) {
    return new Map<string, string>();
  }

  return new Map(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...valueParts] = part.split("=");
        return [name, valueParts.join("=")];
      }),
  );
}

export function getSessionTokenFromRequest(request: Request) {
  const cookies = parseCookieHeader(request.headers.get("cookie"));

  return cookies.get(SESSION_COOKIE_NAME);
}

export async function getAuthenticatedUser(request: Request): Promise<Pick<User, "id" | "username"> | null> {
  const sessionToken = getSessionTokenFromRequest(request);

  return getAuthenticatedUserFromSessionToken(sessionToken);
}

export async function getAuthenticatedUserFromCookies(
  cookieStore: CookieReader,
) {
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  return getAuthenticatedUserFromSessionToken(sessionToken);
}

export async function getAuthenticatedUserFromSessionToken(
  sessionToken: string | undefined,
): Promise<Pick<User, "id" | "username"> | null> {

  if (!sessionToken) {
    return null;
  }

  const session = await db.session.findUnique({
    where: {
      tokenHash: hashSessionToken(sessionToken),
    },
    select: {
      expiresAt: true,
      user: {
        select: {
          id: true,
          username: true,
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt <= new Date()) {
    await db.session.deleteMany({
      where: {
        tokenHash: hashSessionToken(sessionToken),
      },
    });

    return null;
  }

  return session.user;
}
