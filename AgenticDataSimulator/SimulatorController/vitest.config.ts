import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const controllerRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(controllerRoot, "src"),
      "@intent-gen-package": path.resolve(
        controllerRoot,
        "../SimulatorAgentPackages/5g4data-intent-generation",
      ),
      "@intent-obs-package": path.resolve(
        controllerRoot,
        "../SimulatorAgentPackages/5g4data-intent-observations",
      ),
    },
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
  test: {
    environment: "node",
  },
});
