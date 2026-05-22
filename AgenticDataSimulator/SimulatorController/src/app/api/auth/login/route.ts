import { z } from "zod";

import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import {
  buildAuthErrorResponse,
  buildAuthSuccessResponse,
  parseAuthRequestBody,
} from "@/lib/auth/request";
import {
  createSessionCookie,
  createSessionExpiry,
  createSessionToken,
  hashSessionToken,
} from "@/lib/auth/session";

const loginBodySchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

export async function POST(request: Request) {
  const { body, isFormSubmission } = await parseAuthRequestBody(
    request,
    loginBodySchema,
  );

  const user = await db.user.findUnique({
    where: {
      username: body.username,
    },
  });

  if (!user) {
    return buildAuthErrorResponse(
      request,
      isFormSubmission,
      { error: "Invalid username or password." },
      401,
    );
  }

  const isValid = await verifyPassword(body.password, user.passwordHash);

  if (!isValid) {
    return buildAuthErrorResponse(
      request,
      isFormSubmission,
      { error: "Invalid username or password." },
      401,
    );
  }

  const sessionToken = createSessionToken();

  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt: createSessionExpiry(),
    },
  });

  const response = buildAuthSuccessResponse(
    request,
    isFormSubmission,
    {
      user: {
        id: user.id,
        username: user.username,
      },
    },
    200,
  );
  const sessionCookie = createSessionCookie(
    sessionToken,
    process.env.NODE_ENV === "production",
  );

  response.cookies.set(
    sessionCookie.name,
    sessionCookie.value,
    sessionCookie.options,
  );

  return response;
}
