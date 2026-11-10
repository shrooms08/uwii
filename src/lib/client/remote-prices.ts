/**
 * Prices the signed scan did not record (only a source leg the user's answer adds): one GET /api/price per
 * asset and time. The request carries the asset and the time and nothing else.
 */
import type { Asset } from "@/lib/history/types";
import type { PriceProvider, PriceResult } from "@/lib/prices/quotes";

const UNAVAILABLE: PriceResult = { status: "no_verifiable_price", attempted: ["price service unavailable right now"], temporary: true };

export class RemotePriceProvider implements PriceProvider {
  async quote(asset: Asset, timestamp: string): Promise<PriceResult> {
    const q = new URLSearchParams({ asset: asset.symbol, contract: asset.contract ?? "", ts: timestamp });
    try {
      const res = await fetch(`/api/price?${q}`);
      if (!res.ok) return UNAVAILABLE;
      const r = (await res.json()) as PriceResult;
      return r && (r.status === "ok" || r.status === "no_verifiable_price") ? r : UNAVAILABLE;
    } catch {
      return UNAVAILABLE;
    }
  }
}
