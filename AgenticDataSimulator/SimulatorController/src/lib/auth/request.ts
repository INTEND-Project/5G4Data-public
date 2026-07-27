import { NextResponse } from "next/server";
import { z } from "zod";

import { withAppBasePath } from "@/lib/app-paths";

type AuthRequestParseResult<T> = {
  body: T;
  isFormSubmission: boolean;
};

export class AuthValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthValidationError";
  }
}

export function formatAuthBodyValidationError(error: z.ZodError) {
  for (const issue of error.issues) {
    const field = issue.path[0];

    if (field === "username" && issue.code === "too_small") {
      const minimum = "minimum" in issue ? issue.minimum : undefined;
      return minimum === 1
        ? "Username is required."
        : "Username must be at least 3 characters.";
    }

    if (field === "password" && issue.code === "too_small") {
      const minimum = "minimum" in issue ? issue.minimum : undefined;
      return minimum === 1
        ? "Password is required."
        : "Password must be at least 8 characters.";
    }

    if (field === "username") {
      return "Username is required.";
    }

    if (field === "password") {
      return "Password is required.";
    }
  }

  return "Please check your username and password and try again.";
}

function parseAuthBody<T>(schema: z.ZodType<T>, rawBody: unknown): T {
  const parsed = schema.safeParse(rawBody);

  if (!parsed.success) {
    throw new AuthValidationError(formatAuthBodyValidationError(parsed.error));
  }

  return parsed.data;
}

export async function parseAuthRequestBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<AuthRequestParseResult<T>> {
  const contentType = request.headers.get("content-type") ?? "";
  const isFormSubmission = contentType.includes("application/x-www-form-urlencoded");

  if (isFormSubmission) {
    const formData = await request.formData();
    const body = parseAuthBody(schema, {
      username: formData.get("username"),
      password: formData.get("password"),
    });

    return {
      body,
      isFormSubmission: true,
    };
  }

  return {
    body: parseAuthBody(schema, await request.json()),
    isFormSubmission: false,
  };
}

export function buildAuthSuccessResponse(
  _request: Request,
  isFormSubmission: boolean,
  body: Record<string, unknown>,
  status: number,
) {
  if (isFormSubmission) {
    return new NextResponse(null, {
      status: 303,
      headers: {
        location: withAppBasePath("/workspace"),
      },
    });
  }

  return NextResponse.json(body, { status });
}

export function buildAuthErrorResponse(
  _request: Request,
  isFormSubmission: boolean,
  body: Record<string, unknown>,
  status: number,
) {
  if (isFormSubmission) {
    const location = new URL("http://local.placeholder");
    const error = typeof body.error === "string" ? body.error : "Authentication failed.";

    location.pathname = withAppBasePath("/login");
    location.searchParams.set("error", error);

    return new NextResponse(null, {
      status: 303,
      headers: {
        location: `${location.pathname}${location.search}`,
      },
    });
  }

  return NextResponse.json(body, { status });
}
