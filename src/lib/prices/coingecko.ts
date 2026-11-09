/**
 * CoinGecko historical USD prices (D7), keyless public API (https://api.coingecko.com/api/v3).
 * Keyless access is IP rate-limited (no published number); calls are spaced ~6.5s apart with 429 backoff.
 * An optional free Demo key (COINGECKO_DEMO_API_KEY in .env.local) raises the limit to 100 calls/min.
 *
 * Granularity: /coins/{id}/market_chart/range returns hourly points for ranges of 2-90 days, so series
 * are fetched one calendar month at a time (plus 2h overlap) and cached in data/cache/prices/.
 * Prices are read from the JSON source text, never through a binary float.
 */
import path from "node:path";
import { CACHE_DIR, readJsonIfExists, writeJson } from "../history/paths";
import { parseJsonExact } from "../money";

export const COINGECKO_API = "https://api.coingecko.com/api/v3";
const PRICE_DIR = path.join(CACHE_DIR, "prices");
const LIST_CACHE = path.join(CACHE_DIR, "coingecko-near-platform.json");
const MIN_INTERVAL_MS = Number(process.env.COINGECKO_MIN_INTERVAL_MS) || 6_500;
const HOUR_MS = 3_600_000;
/** Longest total wait on 429/5xx for one request; after that the service counts as down for a while. */
const RETRY_BUDGET_MS = Number(process.env.COINGECKO_RETRY_BUDGET_MS) || 30_000;
const DOWN_FOR_MS = 120_000;

/** CoinGecko is rate limiting or failing: prices are unknown for now (not "no verifiable price"). */
export class PriceServiceBusyError extends Error {}
let downUntil = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let nextAt = 0;
async function slot() {
  const now = Date.now();
  const at = Math.max(now, nextAt);
  nextAt = at + MIN_INTERVAL_MS;
  if (at > now) await sleep(at - now);
}

async function cgGet(pathAndQuery: string): Promise<string> {
  if (Date.now() < downUntil) throw new PriceServiceBusyError("CoinGecko is rate limiting; not retrying yet");
  const headers: Record<string, string> = { accept: "application/json" };
  if (process.env.COINGECKO_DEMO_API_KEY) headers["x-cg-demo-api-key"] = process.env.COINGECKO_DEMO_API_KEY;
  let last = "";
  let waited = 0;
  for (let attempt = 1; attempt <= 6 && waited <= RETRY_BUDGET_MS; attempt++) {
    await slot();
    try {
      const res = await fetch(`${COINGECKO_API}${pathAndQuery}`, { headers, signal: AbortSignal.timeout(60_000), cache: "no-store" });
      const text = await res.text();
      if (res.ok) return text;
      last = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 5_000 * attempt;
        waited += wait;
        if (waited > RETRY_BUDGET_MS) break;
        nextAt = Math.max(nextAt, Date.now() + wait);
        continue;
      }
      throw new Error(`CoinGecko ${pathAndQuery.split("?")[0]} failed: ${last}`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("CoinGecko ")) throw e;
      last = e instanceof Error ? e.message : String(e);
      waited += 5_000 * attempt;
      nextAt = Math.max(nextAt, Date.now() + 5_000 * attempt);
    }
  }
  downUntil = Date.now() + DOWN_FOR_MS;
  throw new PriceServiceBusyError(`CoinGecko ${pathAndQuery.split("?")[0]} unavailable: ${last}`);
}

// ---------- asset -> coin id ----------

/** Fixed mappings (D7): NEAR and wNEAR use the NEAR price. */
const FIXED_IDS = new Map<string | null, string>([
  [null, "near"],
  ["wrap.near", "near"],
  ["17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "usd-coin"],
  ["usdt.tether-token.near", "tether"],
]);

let platformMap: Map<string, string> | null = null;

/** NEAR token contract -> CoinGecko id, from /coins/list?include_platform=true (platform "near-protocol"). */
async function nearPlatformMap(): Promise<Map<string, string>> {
  if (platformMap) return platformMap;
  let cached = await readJsonIfExists<{ fetchedAt: string; map: Record<string, string> }>(LIST_CACHE);
  if (!cached) {
    const list = JSON.parse(await cgGet("/coins/list?include_platform=true")) as { id: string; platforms?: Record<string, string | null> }[];
    const map: Record<string, string> = {};
    for (const c of list) {
      const addr = c.platforms?.["near-protocol"];
      if (addr) map[addr.toLowerCase()] = c.id;
    }
    cached = { fetchedAt: new Date().toISOString(), map };
    await writeJson(LIST_CACHE, cached);
  }
  platformMap = new Map(Object.entries(cached.map));
  return platformMap;
}

export async function coinIdFor(contract: string | null): Promise<string | null> {
  if (FIXED_IDS.has(contract)) return FIXED_IDS.get(contract)!;
  return (await nearPlatformMap()).get(contract!.toLowerCase()) ?? null;
}

// ---------- monthly hourly series ----------

interface SeriesFile {
  coinId: string;
  month: string;
  fetchedAt: string;
  /** [unix ms, USD price as exact source text]. */
  points: [string, string][];
}

const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);
const monthStartMs = (m: string) => Date.parse(`${m}-01T00:00:00Z`);
const nextMonth = (m: string) => {
  const d = new Date(monthStartMs(m));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
};

const memo = new Map<string, SeriesFile>();

async function monthSeries(coinId: string, month: string, needMs: number): Promise<SeriesFile> {
  const key = `${coinId}-${month}`;
  const file = path.join(PRICE_DIR, `coingecko-${key}.json`);
  let s = memo.get(key) ?? (await readJsonIfExists<SeriesFile>(file));
  const covers = (x: SeriesFile | null) => !!x && x.points.length > 0 && Number(x.points[x.points.length - 1][0]) + HOUR_MS >= Math.min(needMs, monthStartMs(nextMonth(month)));
  if (!covers(s)) {
    const from = Math.floor((monthStartMs(month) - 2 * HOUR_MS) / 1000);
    const to = Math.floor(Math.min(monthStartMs(nextMonth(month)) + 2 * HOUR_MS, Date.now()) / 1000);
    const text = await cgGet(`/coins/${encodeURIComponent(coinId)}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`);
    const json = parseJsonExact<{ prices?: [string, string][] }>(text);
    if (!Array.isArray(json.prices)) throw new Error(`CoinGecko returned no prices for ${coinId} ${month}`);
    s = { coinId, month, fetchedAt: new Date().toISOString(), points: json.prices.map(([t, p]) => [String(t), String(p)]) };
    await writeJson(file, s);
  }
  memo.set(key, s!);
  return s!;
}

export interface CoinGeckoQuote {
  usd: string;
  granularity: "hourly" | "daily";
  pointTime: string;
  coinId: string;
}

/** Nearest CoinGecko point to `timestamp`: within 1h -> hourly; within 26h -> daily; else null. */
export async function coingeckoQuote(coinId: string, timestamp: string): Promise<CoinGeckoQuote | null> {
  const t = Date.parse(timestamp);
  const months = [...new Set([monthOf(t - 2 * HOUR_MS), monthOf(t), monthOf(t + 2 * HOUR_MS)])];
  let best: [string, string] | null = null;
  let bestDist = Infinity;
  for (const m of months) {
    if (monthStartMs(m) > Date.now()) continue;
    for (const p of (await monthSeries(coinId, m, t)).points) {
      const d = Math.abs(Number(p[0]) - t);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
  }
  if (!best || bestDist > 26 * HOUR_MS) return null;
  return {
    usd: best[1],
    granularity: bestDist <= HOUR_MS ? "hourly" : "daily",
    pointTime: new Date(Number(best[0])).toISOString(),
    coinId,
  };
}
