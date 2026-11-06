/**
 * Deployment health: which features are configured and whether the committed demo fixtures are
 * readable. Reports presence only; never a secret value.
 */
import { access } from "node:fs/promises";
import path from "node:path";
import { NAFEM_CSV } from "../fx/nafem";
import { FIXTURE_DIR } from "../history/paths";
import { DEMO_ACCOUNT } from "../demo/illustrative-answers";

export interface Health {
  ok: boolean;
  network: string;
  configured: { nearAi: boolean; anchor: boolean; archivalRpc: boolean; coingeckoKey: boolean };
  fixturesPresent: boolean;
  version: string;
}

/** Files the demo account needs with no live data calls. */
export const REQUIRED_FIXTURES = [
  path.join(FIXTURE_DIR, `${DEMO_ACCOUNT}-2026.json`),
  path.join(FIXTURE_DIR, `${DEMO_ACCOUNT}-2026.classified.json`),
  path.join(FIXTURE_DIR, `${DEMO_ACCOUNT}-2026.prices.json`),
  path.join(FIXTURE_DIR, `${DEMO_ACCOUNT}-2026.opening.json`),
  NAFEM_CSV,
];

const set = (v: string | undefined) => Boolean(v && v.trim());
/** Inlined by Next at build time (next.config env); must be read as a literal process.env access. */
const BUILD_SHA = process.env.UWII_BUILD_SHA;

export async function health(env: Record<string, string | undefined> = process.env): Promise<Health> {
  const present = await Promise.all(REQUIRED_FIXTURES.map((f) => access(f).then(() => true, () => false)));
  const fixturesPresent = present.every(Boolean);
  const network = env.NEAR_NETWORK?.trim() || "testnet";
  return {
    ok: fixturesPresent && network === "testnet",
    network,
    configured: {
      nearAi: set(env.NEAR_AI_API_KEY),
      anchor: set(env.NEAR_ANCHOR_ACCOUNT_ID) && set(env.NEAR_ANCHOR_CONTRACT_ID) && set(env.NEAR_ANCHOR_PRIVATE_KEY),
      archivalRpc: set(env.NEAR_ARCHIVAL_RPC_URL),
      coingeckoKey: set(env.COINGECKO_DEMO_API_KEY),
    },
    fixturesPresent,
    version: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || env.UWII_BUILD_SHA || BUILD_SHA || "unknown",
  };
}
