/** Server start-up hook. Only used for test fault injection, which is inert on every deployment (see faults.ts). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL || !process.env.UWII_FAULTS) return;
  const { installFaults } = await import("./lib/server/faults");
  installFaults();
}
