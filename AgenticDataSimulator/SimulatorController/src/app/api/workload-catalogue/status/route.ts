import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { parseWorkloadCatalogBaseUrlInput } from "@/lib/workload-catalogue/resolve-base-url";
import { getWorkloadCatalogConnectionStatus } from "@/lib/workload-catalogue/status";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workloadCatalogBaseUrlParam = new URL(request.url).searchParams
    .get("workloadCatalogBaseUrl")
    ?.trim();
  let workloadCatalogBaseUrl: string | undefined;
  if (workloadCatalogBaseUrlParam) {
    const parsed = parseWorkloadCatalogBaseUrlInput(workloadCatalogBaseUrlParam);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    workloadCatalogBaseUrl = parsed.url;
  }

  const connected = await getWorkloadCatalogConnectionStatus(workloadCatalogBaseUrl);
  return NextResponse.json({ connected });
}
