import { NextResponse } from "next/server";
import { z } from "zod";

import { withAppBasePath } from "@/lib/app-paths";

type AuthRequestParseResult<T> = {
  body: T;
  isFormSubmission: boolean;
};

export async function parseAuthRequestBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<AuthRequestParseResult<T>> {
  const contentType = request.headers.get("content-type") ?? "";
  const isFormSubmission = contentType.includes("application/x-www-form-urlencoded");

  if (isFormSubmission) {
    const formData = await request.formData();
    const body = schema.parse({
      username: formData.get("username"),
      password: formData.get("password"),
    });

    return {
      body,
      isFormSubmission: true,
    };
  }

  return {
    body: schema.parse(await request.json()),
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
