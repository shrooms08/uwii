/**
 * GET /api/price?asset=<symbol>&contract=<NEAR contract or empty>&ts=<ISO time>: one USD price.
 *
 * The browser calls this only when an answer adds a source leg the signed scan did not price. The request
 * carries an asset and a time and nothing else: no account id, no answers, no amounts. Nothing is logged.
 */
import { z } from "zod";
import { isValidAccountId } from "@/lib/near/account-id";
import type { PriceProvider } from "@/lib/prices/quotes";

/** Earliest price looked up (NEAR mainnet launched in 2020; CoinGecko has nothing earlier for its tokens). */
const EARLIEST = Date.parse("2020-01-01T00:00:00Z");

const Query = z
  .object({
    asset: z.string().trim().min(1).max(64).regex(/^[^\u0000-\u001f]+$/u, "invalid asset symbol"),
    contract: z
      .string()
      .trim()
      .toLowerCase()
      .max(64)
      .refine((c) => c === "" || isValidAccountId(c), "invalid contract")
      .optional(),
    ts: z
      .string()
      .max(40)
      .refine((t) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(t) && Number.isFinite(Date.parse(t)), "ts must be an ISO time in UTC")
      .refine((t) => Date.parse(t) >= EARLIEST && Date.parse(t) <= Date.now(), "ts is out of range"),
  })
  .strict();

const noStore = { "cache-control": "no-store" };

export async function handlePrice(params: URLSearchParams, prices: PriceProvider): Promise<Response> {
  const parsed = Query.safeParse(Object.fromEntries(params));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400, headers: noStore });
  const { asset, contract, ts } = parsed.data;
  const result = await prices.quote({ symbol: asset, contract: contract || null, decimals: 0 }, ts);
  // A historical price does not change: a found (or provably missing) price may be cached; a busy service may not.
  const cacheable = result.status === "ok" || !result.temporary;
  return Response.json(result, { headers: cacheable ? { "cache-control": "public, max-age=86400" } : noStore });
}
