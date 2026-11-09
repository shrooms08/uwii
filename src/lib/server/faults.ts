/**
 * Fault injection for resilience testing. UWII_FAULTS is a comma list, e.g. "nearai402,archival429".
 *
 * Inert on every deployment: it is read only outside production (or with UWII_ENABLE_DEV_PAGES=1 on a local
 * production build), and never when VERCEL is set, whatever the other variables say. When inert nothing is
 * wrapped: the app's fetch is the platform's.
 *
 * While active, the reserved test account SIM_ACCOUNT gets a small simulated history (no NearBlocks quota is
 * used) and block lookups and prices are simulated, so each failure can be exercised end to end offline.
 */

export const FAULTS = ["nearai402", "nearblocks429", "archival429", "coingecko429", "timeout", "sim"] as const;
export type Fault = (typeof FAULTS)[number];

/** Reserved account that only exists inside the fault simulator. */
export const SIM_ACCOUNT = "uwii-fault-sim.near";

type Env = Record<string, string | undefined>;

export function activeFaults(env: Env = process.env): Set<Fault> {
  if (env.VERCEL) return new Set();
  if (env.NODE_ENV === "production" && env.UWII_ENABLE_DEV_PAGES?.trim() !== "1") return new Set();
  const known = new Set<string>(FAULTS);
  return new Set((env.UWII_FAULTS ?? "").split(",").map((f) => f.trim()).filter((f): f is Fault => known.has(f)));
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

// A simulated chain: one block every 600 ms.
const ORIGIN_MS = 1_700_000_000_000;
const ORIGIN_HEIGHT = 100_000_000;
const msOfHeight = (h: number) => ORIGIN_MS + (h - ORIGIN_HEIGHT) * 600;
const heightOfMs = (ms: number) => ORIGIN_HEIGHT + Math.floor((ms - ORIGIN_MS) / 600);
const header = (h: number) => ({ header: { height: h, hash: `sim${h}`, timestamp_nanosec: `${msOfHeight(h)}000000` } });
const viewResult = (value: unknown) => ({ jsonrpc: "2.0", id: "uwii", result: { result: [...Buffer.from(JSON.stringify(value))] } });

/** The simulated account's only stake: three days ago, so a scan needs just a few snapshots. */
const depositMs = () => Math.floor(Date.now() / 86_400_000) * 86_400_000 - 3 * 86_400_000 + 3_600_000;
const SIM_POOL = "sim.poolv1.near";
const SIM_DEPOSIT = "1000000000000000000000000000"; // 1,000 NEAR

function simNearBlocks(url: URL, faults: Set<Fault>): Response | null {
  const m = new RegExp(`^/v3/accounts/${SIM_ACCOUNT}/(stats/txns|receipts|staking-txns|ft-txns|txns)$`).exec(url.pathname);
  if (!m) return null;
  const page = (data: unknown[], next: string | null = null) => json({ data, meta: { next_page: next } });
  switch (m[1]) {
    case "stats/txns":
      return json({ data: [{ account: SIM_ACCOUNT, date: "2026-03-01", txns: "3" }] });
    case "staking-txns":
      return page([{ account: SIM_ACCOUNT, amount: SIM_DEPOSIT, contract: SIM_POOL, receipt_id: "simreceipt", transaction_hash: "simtx", type: "DEPOSIT", block_timestamp: `${depositMs()}000000` }]);
    case "receipts": {
      if (!faults.has("timeout")) return page([]);
      // An endless account: every page is full and there is always another.
      const n = Number(url.searchParams.get("next") ?? 0);
      const rows = Array.from({ length: 25 }, (_, i) => ({
        receipt_id: `simr${n}-${i}`,
        transaction_hash: `simt${n}-${i}`,
        predecessor_account_id: "someone.near",
        receiver_account_id: SIM_ACCOUNT,
        actions: [{ action: "TRANSFER", method: null }],
        actions_agg: { deposit: "1000000000000000000000000" },
        outcome: { status: true },
        block: { block_timestamp: `${Date.UTC(2026, 9, 1) - n * 60_000 - i}000000` },
      }));
      return page(rows, String(n + 1));
    }
    default:
      return page([]);
  }
}

function simRpc(url: URL, init: RequestInit | undefined): Response | null {
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { method?: string; params?: Record<string, unknown> }) : null;
  if (url.hostname === "free.rpc.fastnear.com" && body?.method === "block") return json({ result: header(heightOfMs(Date.now())) });
  if (!url.hostname.startsWith("archival-rpc.mainnet.") || body?.method !== "query") return null;
  const p = body.params ?? {};
  if (p.request_type === "view_account") return json({ jsonrpc: "2.0", id: "uwii", result: { amount: "5000000000000000000000000", locked: "0" } });
  if (p.method_name === "get_account_total_balance") {
    const growth = BigInt(Math.max(0, Number(p.block_id) - heightOfMs(depositMs()))) * BigInt("10000000000000000000");
    return json(viewResult((BigInt(SIM_DEPOSIT) + growth).toString()));
  }
  return json(viewResult("0"));
}

function simPrices(url: URL): Response {
  const from = Number(url.searchParams.get("from")) * 1000;
  const to = Number(url.searchParams.get("to")) * 1000;
  const points: string[] = [];
  for (let t = from; t <= to; t += 3_600_000) points.push(`[${t},3.5]`);
  return new Response(`{"prices":[${points.join(",")}]}`, { headers: { "content-type": "application/json" } });
}

/** The injected response for a request, or null to let it through to the network. */
export function faultResponse(input: string, init: RequestInit | undefined, faults: Set<Fault>): Response | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const host = url.hostname;
  if (host === "cloud-api.near.ai" && faults.has("nearai402")) return json({ error: { message: "Payment required: credit exhausted (fault injection)" } }, 402);
  if (host === "api.nearblocks.io") {
    if (faults.has("nearblocks429")) return json({ message: "rate limited (fault injection)" }, 429);
    return simNearBlocks(url, faults);
  }
  if (host.startsWith("archival-rpc.mainnet.") && faults.has("archival429")) return json({ error: "rate limited (fault injection)" }, 429, { "retry-after": "500" });
  if (host === "api.coingecko.com") return faults.has("coingecko429") ? json({ status: "rate limited (fault injection)" }, 429) : simPrices(url);
  if (host === "mainnet.neardata.xyz") {
    const m = /^\/v0\/block\/(\d+)\/headers$/.exec(url.pathname);
    return m ? json(header(Number(m[1]))) : null;
  }
  return simRpc(url, init);
}

export function faultFetch(faults: Set<Fault>, real: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return faultResponse(url, init, faults) ?? real(input, init);
  };
}

/** Wraps global fetch when faults are active; returns whether it did. */
export function installFaults(env: Env = process.env): boolean {
  const faults = activeFaults(env);
  if (faults.size === 0) return false;
  globalThis.fetch = faultFetch(faults, globalThis.fetch.bind(globalThis));
  console.warn(`[uwii] fault injection active: ${[...faults].join(", ")}`);
  return true;
}
