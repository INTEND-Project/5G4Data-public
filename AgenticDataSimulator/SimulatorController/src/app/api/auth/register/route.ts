import { z } from "zod";

import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import {
  AuthValidationError,
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
import {
  GrafanaProvisioningError,
  provisionGrafanaUser,
} from "@/lib/grafana/provision-user";

const registerBodySchema = z.object({
  username: z.string().trim().min(3).max(64),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  const isFormSubmission = (request.headers.get("content-type") ?? "").includes(
    "application/x-www-form-urlencoded",
  );
  let body: z.infer<typeof registerBodySchema>;

  try {
    ({ body } = await parseAuthRequestBody(request, registerBodySchema));
  } catch (error) {
    if (error instanceof AuthValidationError) {
      return buildAuthErrorResponse(
        request,
        isFormSubmission,
        { error: error.message },
        400,
      );
    }

    throw error;
  }

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

  try {
    await provisionGrafanaUser({
      login: body.username,
      password: body.password,
      name: body.username,
    });
  } catch (error) {
    await db.user.delete({ where: { id: user.id } });

    if (error instanceof GrafanaProvisioningError) {
      return buildAuthErrorResponse(
        request,
        isFormSubmission,
        {
          error:
            "Could not create the Grafana account for this user. Check Grafana configuration or try again later.",
        },
        503,
      );
    }

    throw error;
  }

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
