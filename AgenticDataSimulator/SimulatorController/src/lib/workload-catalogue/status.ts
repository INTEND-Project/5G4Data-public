import { resolveWorkloadCatalogBaseUrl } from "@/lib/workload-catalogue/resolve-base-url";

export async function getWorkloadCatalogConnectionStatus(
  workloadCatalogBaseUrl?: string | null,
): Promise<boolean> {
  const baseUrl = resolveWorkloadCatalogBaseUrl(workloadCatalogBaseUrl);

  try {
    const response = await fetch(`${baseUrl}/api/charts?limit=1`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    return response.ok;
  } catch {
    return false;
  }
}
