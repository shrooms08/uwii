/**
 * Public price lookup: GET /api/price?asset=&contract=&ts= -> one USD price (CoinGecko, else the Rhea/Ref
 * primary pair). Reveals only an asset and a time to the server: no account, answers or amounts.
 */
import type { NextRequest } from "next/server";
import { handlePrice } from "@/lib/api/price-handler";
import { LivePriceProvider } from "@/lib/prices/provider";
import { apiLimit } from "@/lib/server/limits";

/** One price: paced CoinGecko calls, at most 40 s before the answer says the service is busy. */
export const maxDuration = 60;
const PRICE_TIME_BUDGET_MS = 40_000;

export function GET(request: NextRequest) {
  const limited = apiLimit("pricePerIp", request);
  if (limited) return limited;
  return handlePrice(request.nextUrl.searchParams, new LivePriceProvider(Date.now() + PRICE_TIME_BUDGET_MS));
}
