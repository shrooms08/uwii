import { execSync } from "node:child_process";
import type { NextConfig } from "next";

/** Short git SHA at build time (Vercel also provides VERCEL_GIT_COMMIT_SHA at runtime). */
function buildSha(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  env: { UWII_BUILD_SHA: buildSha() },
  // Files the API routes read at runtime by path (fixtures, CBN NFEM rates). File tracing cannot see
  // paths built with process.cwd(), so include them explicitly in every API function bundle.
  outputFileTracingIncludes: {
    "/api/**/*": ["./data/fixtures/**/*", "./data/fx/**/*"],
  },
};

export default nextConfig;
