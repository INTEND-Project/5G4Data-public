import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { listWorkloadCatalogCharts } from "@/lib/workload-catalogue/list-charts";
import { parseWorkloadCatalogBaseUrlInput } from "@/lib/workload-catalogue/resolve-base-url";

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

  try {
    const workloads = await listWorkloadCatalogCharts(workloadCatalogBaseUrl);
    return NextResponse.json({ workloads });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list workloads.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
