import { NextResponse } from "next/server";

import { withAppBasePath } from "@/lib/app-paths";
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

  const contentType = request.headers.get("content-type") ?? "";
  const isFormSubmission = contentType.includes("application/x-www-form-urlencoded");

  const response = isFormSubmission
    ? new NextResponse(null, {
        status: 303,
        headers: {
          location: withAppBasePath("/login"),
        },
      })
    : NextResponse.json({ ok: true });
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
