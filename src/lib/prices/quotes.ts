/**
 * Price types and the providers that need no network or file access (shared by server and browser).
 * A price is never invented: a missing quote is reported as such.
 */
import type { Asset } from "../history/types";

export interface PriceQuote {
  usd: string;
  granularity: "hourly" | "daily" | "pool_block";
  /** Time of the observation used. */
  pointTime: string;
  source: string;
  method: string;
}

/** temporary: the price could not be fetched right now (a busy service), so the line is unpriced for this run only. */
export type PriceResult = { status: "ok"; quote: PriceQuote } | { status: "no_verifiable_price"; attempted: string[]; temporary?: true };

export interface PriceProvider {
  quote(asset: Asset, timestamp: string): Promise<PriceResult>;
}

export const priceKey = (asset: Asset, timestamp: string) => `${asset.contract ?? "native:" + asset.symbol}|${timestamp}`;

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

