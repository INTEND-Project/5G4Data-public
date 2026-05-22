import { z } from "zod";

import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
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

const registerBodySchema = z.object({
  username: z.string().trim().min(3).max(64),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  const { body, isFormSubmission } = await parseAuthRequestBody(
    request,
    registerBodySchema,
  );

  const existingUser = await db.user.findUnique({
    where: {
      username: body.username,
    },
  });

  if (existingUser) {
    return buildAuthErrorResponse(
      request,
      isFormSubmission,
      { error: "Username already exists." },
      409,
    );
  }

  const passwordHash = await hashPassword(body.password);
  const user = await db.user.create({
    data: {
      username: body.username,
      passwordHash,
    },
    select: {
      id: true,
      username: true,
    },
  });

  const sessionToken = createSessionToken();

  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt: createSessionExpiry(),
    },
  });

  const response = buildAuthSuccessResponse(request, isFormSubmission, { user }, 201);
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
