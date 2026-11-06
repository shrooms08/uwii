/**
 * The /dev/* developer pages call live services (NEAR AI, NearBlocks) without the hosted-demo limits,
 * so they are off in production (NODE_ENV=production or on Vercel) unless UWII_ENABLE_DEV_PAGES=1.
 */
export function devPagesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.UWII_ENABLE_DEV_PAGES?.trim() === "1") return true;
  return env.NODE_ENV !== "production" && !env.VERCEL;
}
