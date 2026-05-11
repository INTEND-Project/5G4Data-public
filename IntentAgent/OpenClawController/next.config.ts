import type { NextConfig } from "next";

import { getConfiguredAppBasePath } from "./src/lib/app-paths";

const configuredBasePath = getConfiguredAppBasePath(process.env);

const nextConfig: NextConfig = {
  ...(configuredBasePath ? { basePath: configuredBasePath } : {}),
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
