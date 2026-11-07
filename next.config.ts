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

/**
 * Content Security Policy (production only: next dev needs eval for hot reload). Everything the browser
 * loads is same-origin: next/font self-hosts the fonts, the PDF fonts are under /pdf-fonts, and NEAR AI,
 * NearBlocks, CoinGecko and NEAR RPC are called only from the server. 'unsafe-inline' for scripts is
 * needed by Next's inline bootstrap and RSC payload: a nonce would force every page to render
 * dynamically, losing the static shells. No third-party origin is allowed anywhere.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = [
  ...(process.env.NODE_ENV === "production" ? [{ key: "Content-Security-Policy", value: CSP }] : []),
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  cacheComponents: true,
  partialPrefetching: true,
  env: { UWII_BUILD_SHA: buildSha() },
  // Files the API routes read at runtime by path (fixtures, CBN NFEM rates). File tracing cannot see
  // paths built with process.cwd(), so include them explicitly in every API function bundle.
  outputFileTracingIncludes: {
    "/api/**/*": ["./data/fixtures/**/*", "./data/fx/**/*"],
    // Social card images: fonts, and the demo fixtures for the result card (if they ever re-render at runtime).
    "/opengraph-image": ["./public/pdf-fonts/**/*"],
    "/twitter-image": ["./public/pdf-fonts/**/*"],
    "/result/opengraph-image": ["./public/pdf-fonts/**/*", "./data/fixtures/**/*", "./data/fx/**/*"],
    "/result/twitter-image": ["./public/pdf-fonts/**/*", "./data/fixtures/**/*", "./data/fx/**/*"],
  },
};

export default nextConfig;
