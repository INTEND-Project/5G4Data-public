import type { NextConfig } from "next";

import { getConfiguredAppBasePath } from "./src/lib/app-paths";

const configuredBasePath = getConfiguredAppBasePath(process.env);

function resolveDistDir(): string {
  if (process.env.CONTROLLER_DEV_DIST === "1") {
    return ".next-dev-prod";
  }

  if (process.env.NODE_ENV === "development") {
    return ".next-dev";
  }

  return ".next";
}

const nextConfig: NextConfig = {
  ...(configuredBasePath ? { basePath: configuredBasePath } : {}),
  distDir: resolveDistDir(),
  allowedDevOrigins: ["start5g-1.cs.uit.no"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "intendproject.eu",
        pathname: "/assets/**",
      },
      {
        protocol: "https",
        hostname: "intendproject.eu",
        pathname: "/intend-icon.png",
      },
    ],
  },
};

export default nextConfig;
