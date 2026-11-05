/**
 * Price providers. Live: CoinGecko (direct listing) -> Rhea/Ref primary pair (9.2(1)) ->
 * no_verifiable_price with the methods attempted (9.2(4)). Fixture: committed quotes only.
 * A price is never invented: a missing quote is reported as such.
 */
import type { Asset } from "../history/types";
import { readJsonIfExists, writeJson } from "../history/paths";
import { coinIdFor, coingeckoQuote } from "./coingecko";
import { poolQuote } from "./refpool";

export interface PriceQuote {
  usd: string;
  granularity: "hourly" | "daily" | "pool_block";
  /** Time of the observation used. */
  pointTime: string;
  source: string;
  method: string;
}

export type PriceResult = { status: "ok"; quote: PriceQuote } | { status: "no_verifiable_price"; attempted: string[] };

export interface PriceProvider {
  quote(asset: Asset, timestamp: string): Promise<PriceResult>;
}

export const priceKey = (asset: Asset, timestamp: string) => `${asset.contract ?? "native:" + asset.symbol}|${timestamp}`;

export class LivePriceProvider implements PriceProvider {
  async quote(asset: Asset, timestamp: string): Promise<PriceResult> {
    const attempted: string[] = [];
    const id = await coinIdFor(asset.contract);
    if (id) {
      const q = await coingeckoQuote(id, timestamp);
      if (q) {
        return {
          status: "ok",
          quote: { usd: q.usd, granularity: q.granularity, pointTime: q.pointTime, source: "CoinGecko", method: `CoinGecko ${q.coinId} ${q.granularity} point ${q.pointTime}` },
        };
      }
      attempted.push(`CoinGecko ${id}: no point within 26h of ${timestamp}`);
    } else {
      attempted.push(`CoinGecko: no listing for NEAR contract ${asset.contract}`);
    }
    if (asset.contract) {
      const p = await poolQuote(asset.contract, timestamp, async (ts) => (await coingeckoQuote("near", ts))?.usd ?? null);
      if (p.ok) return { status: "ok", quote: { usd: p.quote.usd, granularity: "pool_block", pointTime: p.quote.pointTime, source: "Rhea/Ref pool + CoinGecko NEAR", method: p.quote.method } };
      attempted.push(p.attempted);
    }
    return { status: "no_verifiable_price", attempted };
  }
}

/** Wraps a provider and remembers every result, so they can be committed as a fixture. */
export class RecordingPriceProvider implements PriceProvider {
  readonly results = new Map<string, PriceResult>();
  constructor(private readonly inner: PriceProvider) {}
  async quote(asset: Asset, timestamp: string): Promise<PriceResult> {
    const key = priceKey(asset, timestamp);
    const hit = this.results.get(key);
    if (hit) return hit;
    const r = await this.inner.quote(asset, timestamp);
    this.results.set(key, r);
    return r;
  }
}

export interface PriceFixture {
  generatedAt: string;
  quotes: Record<string, PriceResult>;
}

/** Committed quotes first; anything missing falls through to `fallback` (or throws when there is none). */
export class FixturePriceProvider implements PriceProvider {
  constructor(
    private readonly fixture: PriceFixture,
    private readonly fallback: PriceProvider | null,
  ) {}
  async quote(asset: Asset, timestamp: string): Promise<PriceResult> {
    const hit = this.fixture.quotes[priceKey(asset, timestamp)];
    if (hit) return hit;
    if (!this.fallback) throw new Error(`No committed price for ${asset.symbol} at ${timestamp} and live pricing is disabled`);
    return this.fallback.quote(asset, timestamp);
  }
}

export async function loadPriceFixture(file: string): Promise<PriceFixture | null> {
  return readJsonIfExists<PriceFixture>(file);
}

export async function writePriceFixture(file: string, results: Map<string, PriceResult>): Promise<void> {
  const quotes: Record<string, PriceResult> = {};
  for (const k of [...results.keys()].sort()) quotes[k] = results.get(k)!;
  await writeJson(file, { generatedAt: new Date().toISOString(), quotes } satisfies PriceFixture);
}
