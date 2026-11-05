/**
 * Dollar price via a token's primary trading pair (circular 9.2(1)) when CoinGecko has no listing:
 * the Rhea (Ref Finance) v2 pool pairing the token with wNEAR that has the largest wNEAR reserve.
 * price_usd = (wNEAR reserve / token reserve, decimal-adjusted) x NEAR/USD, with reserves read via
 * archival RPC at the block closest to the transaction time.
 *
 * The pool index (and a Rhea DCL v2 presence check) is built once from current state and cached.
 */
import path from "node:path";
import { closestBlock, finalBlock, viewAtBlock } from "../history/chain";
import { resolveFtMetadata } from "../history/ft-metadata";
import { CACHE_DIR, readJsonIfExists, writeJson } from "../history/paths";
import { Dec, dec, full } from "../money";

const RPC = "https://free.rpc.fastnear.com";
export const REF_V2 = "v2.ref-finance.near";
export const REF_DCL = "dclv2.ref-labs.near";
const WNEAR = "wrap.near";
const INDEX_FILE = path.join(CACHE_DIR, "ref-pools-index.json");

async function viewNow<T>(contract: string, method: string, args: object): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "uwii",
      method: "query",
      params: { finality: "final", request_type: "call_function", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const j = (await res.json()) as { result?: { result?: number[] }; error?: unknown };
  if (!j.result?.result) throw new Error(`${contract}.${method} failed: ${JSON.stringify(j.error ?? j.result).slice(0, 200)}`);
  return JSON.parse(Buffer.from(j.result.result).toString("utf8")) as T;
}

interface PoolIndex {
  builtAt: string;
  v2PoolCount: number;
  dclPoolCount: number;
  /** token -> v2 pools pairing it with wNEAR, with the current wNEAR reserve (yocto). */
  wnearPools: Record<string, { poolId: number; wnearReserve: string }[]>;
  /** tokens that appear in any DCL v2 pool. */
  dclTokens: string[];
  /** tokens that appear in any v2 pool. */
  v2Tokens: string[];
}

let indexMemo: PoolIndex | null = null;

export async function poolIndex(): Promise<PoolIndex> {
  if (indexMemo) return indexMemo;
  const cached = await readJsonIfExists<PoolIndex>(INDEX_FILE);
  if (cached) return (indexMemo = cached);
  const n = await viewNow<number>(REF_V2, "get_number_of_pools", {});
  const wnearPools: PoolIndex["wnearPools"] = {};
  const v2Tokens = new Set<string>();
  for (let i = 0; i < n; i += 500) {
    const pools = await viewNow<{ token_account_ids: string[]; amounts: string[]; pool_kind: string }[]>(REF_V2, "get_pools", { from_index: i, limit: 500 });
    pools.forEach((p, k) => {
      p.token_account_ids.forEach((t) => v2Tokens.add(t));
      if (p.pool_kind !== "SIMPLE_POOL" || p.token_account_ids.length !== 2) return;
      const w = p.token_account_ids.indexOf(WNEAR);
      if (w < 0) return;
      const other = p.token_account_ids[1 - w];
      (wnearPools[other] ??= []).push({ poolId: i + k, wnearReserve: p.amounts[w] });
    });
  }
  const dclTokens = new Set<string>();
  let dclCount = 0;
  for (let i = 0; ; i += 200) {
    const pools = await viewNow<{ token_x: string; token_y: string }[]>(REF_DCL, "list_pools", { from_index: i, limit: 200 });
    dclCount += pools.length;
    for (const p of pools) {
      dclTokens.add(p.token_x);
      dclTokens.add(p.token_y);
    }
    if (pools.length < 200) break;
  }
  indexMemo = { builtAt: new Date().toISOString(), v2PoolCount: n, dclPoolCount: dclCount, wnearPools, dclTokens: [...dclTokens], v2Tokens: [...v2Tokens] };
  await writeJson(INDEX_FILE, indexMemo);
  return indexMemo;
}

/** wNEAR per token from pool reserves, decimal-adjusted. */
export function priceInNear(tokenReserve: string, tokenDecimals: number, wnearReserve: string): Dec {
  const t = dec(tokenReserve).div(new Dec(10).pow(tokenDecimals));
  const w = dec(wnearReserve).div(new Dec(10).pow(24));
  if (t.isZero()) throw new Error("empty token reserve");
  return w.div(t);
}

export interface PoolQuote {
  usd: string;
  pointTime: string;
  method: string;
}

export type PoolResult = { ok: true; quote: PoolQuote } | { ok: false; attempted: string };

/** Primary-pair price at `timestamp`, or the documented reason none exists. */
export async function poolQuote(contract: string, timestamp: string, nearUsdAt: (ts: string) => Promise<string | null>): Promise<PoolResult> {
  const idx = await poolIndex();
  const pools = (idx.wnearPools[contract] ?? []).slice().sort((a, b) => (BigInt(b.wnearReserve) > BigInt(a.wnearReserve) ? 1 : -1));
  if (!pools.length) {
    const where = [idx.v2Tokens.includes(contract) ? "in a non-wNEAR Rhea v2 pool only" : null, idx.dclTokens.includes(contract) ? "in a Rhea DCL v2 pool (concentrated liquidity; not used for pricing)" : null].filter(Boolean);
    return {
      ok: false,
      attempted: `Rhea/Ref v2: no simple pool pairing ${contract} with wNEAR among ${idx.v2PoolCount} pools; Rhea DCL v2 scanned (${idx.dclPoolCount} pools)${where.length ? `; token found ${where.join(" and ")}` : "; token not present"}`,
    };
  }
  const pool = pools[0];
  const block = await closestBlock(BigInt(Date.parse(timestamp)) * BigInt(1_000_000), await finalBlock());
  const state = (await viewAtBlock(REF_V2, "get_pool", { pool_id: pool.poolId }, block.height)) as { token_account_ids: string[]; amounts: string[] };
  const w = state.token_account_ids.indexOf(WNEAR);
  const meta = (await resolveFtMetadata(new Map([[contract, {}]]))).get(contract)!;
  const inNear = priceInNear(state.amounts[1 - w], meta.decimals, state.amounts[w]);
  const nearUsd = await nearUsdAt(timestamp);
  if (!nearUsd) return { ok: false, attempted: `Rhea v2 pool #${pool.poolId} found but no NEAR/USD price at ${timestamp}` };
  return {
    ok: true,
    quote: {
      usd: full(inNear.mul(dec(nearUsd))),
      pointTime: new Date(Number(block.timestampNs / BigInt(1_000_000))).toISOString(),
      method: `Rhea v2 pool #${pool.poolId} (${contract}/wNEAR, largest wNEAR reserve) at block ${block.height}: ${full(inNear)} NEAR x NEAR/USD ${nearUsd}`,
    },
  };
}
