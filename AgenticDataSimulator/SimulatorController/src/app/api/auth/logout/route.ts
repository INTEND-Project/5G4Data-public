import { NextResponse } from "next/server";

import { getSessionTokenFromRequest } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import {
  createClearedSessionCookie,
  hashSessionToken,
} from "@/lib/auth/session";

export async function POST(request: Request) {
  const sessionToken = getSessionTokenFromRequest(request);

  if (sessionToken) {
    await db.session.deleteMany({
      where: {
        tokenHash: hashSessionToken(sessionToken),
      },
    });
  }

  const response = NextResponse.json({ ok: true });
  const clearedCookie = createClearedSessionCookie(
    process.env.NODE_ENV === "production",
  );

  response.cookies.set(
    clearedCookie.name,
    clearedCookie.value,
    clearedCookie.options,
  );

  return response;
}
