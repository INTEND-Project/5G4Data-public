import { loadAppEnv } from "@/lib/env";
import { REGISTRY_LIST_PATHS } from "@/lib/registry/paths";

export async function getRegistryConnectionStatus() {
  const env = loadAppEnv(process.env);

  for (const path of REGISTRY_LIST_PATHS) {
    try {
      const response = await fetch(`${env.a2aRegistryBaseUrl}${path}`, {
        cache: "no-store",
      });

      if (response.ok) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}
