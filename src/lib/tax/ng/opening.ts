/**
 * Opening position at the first block of 1 January 2026 UTC (D11), via archival RPC, cached.
 * Liquid NEAR (view_account amount + locked), NEAR staked in pools (Phase 2b snapshot at 2026-01-01
 * 00:00), and NEP-141 balances for every token contract seen in the account's history.
 * If the account did not exist at that block, every balance is zero (no further queries).
 */
import path from "node:path";
import { firstBlockAtOrAfter, viewAccountAtBlock, viewAtBlock } from "../../history/chain";
import { CACHE_DIR, readJsonIfExists, writeJson } from "../../history/paths";
import type { Asset, HistoryResult } from "../../history/types";
import { NEAR_ASSET } from "../../history/types";
import { formatUnits } from "../../history/amount";
import { LIQUID_STAKING_CONTRACTS } from "./labels";

export const OPENING_YEAR = 2026;
export const RESET_PRICE_TIME = "2025-12-31T23:59:59.000Z";

export interface OpeningBalance {
  asset: Asset;
  /** Exact decimal quantity. */
  qty: string;
  source: string;
}

export interface OpeningPosition {
  schemaVersion: 1;
  accountId: string;
  date: string;
  block: { height: number; hash: string; timestampNs: string };
  accountExisted: boolean;
  balances: OpeningBalance[];
  fetchedAt: string;
  method: string;
}

/** What the opening position needs from the history (small enough to travel inside a signed run). */
export interface OpeningInputs {
  accountId: string;
  /** Token assets seen in the history (contract, symbol, decimals). */
  tokens: Asset[];
  /** Staking pools with their balance at the first snapshot of the year. */
  stakingStarts: { pool: string; date: string; totalBalance: string; blockHeight: number | null }[];
}

export function openingInputsFromHistory(history: HistoryResult): OpeningInputs {
  const tokens = new Map<string, Asset>();
  for (const r of history.records) if (r.asset.contract) tokens.set(r.asset.contract, r.asset);
  return {
    accountId: history.accountId,
    tokens: [...tokens.values()],
    stakingStarts: history.staking.pools.map((p) => ({ pool: p.pool, date: p.start.date, totalBalance: p.start.totalBalance, blockHeight: p.start.block?.height ?? null })),
  };
}

export const openingCachePath = (accountId: string) => path.join(CACHE_DIR, `opening-${accountId}-${OPENING_YEAR}.json`);

export async function fetchOpeningPosition(source: HistoryResult | OpeningInputs, onProgress?: (m: string) => void): Promise<OpeningPosition> {
  const inputs = "records" in source ? openingInputsFromHistory(source) : source;
  const cacheFile = openingCachePath(inputs.accountId);
  const cached = await readJsonIfExists<OpeningPosition>(cacheFile);
  if (cached?.schemaVersion === 1) return cached;

  const date = `${OPENING_YEAR}-01-01`;
  const block = await firstBlockAtOrAfter(BigInt(Date.parse(`${date}T00:00:00Z`)) * BigInt(1_000_000));
  onProgress?.(`Opening position: first block of ${date} is ${block.height}; querying account state (archival RPC)…`);
  const state = await viewAccountAtBlock(inputs.accountId, block.height, onProgress);
  const balances: OpeningBalance[] = [];

  if (state) {
    const liquid = BigInt(state.amount) + BigInt(state.locked);
    if (liquid > BigInt(0)) balances.push({ asset: NEAR_ASSET, qty: formatUnits(liquid, 24), source: "view_account amount + locked" });
    for (const p of inputs.stakingStarts) {
      if (p.date === date && BigInt(p.totalBalance) > BigInt(0)) {
        balances.push({ asset: NEAR_ASSET, qty: formatUnits(BigInt(p.totalBalance), 24), source: `staked in ${p.pool} (get_account_total_balance @${p.blockHeight ?? "?"})` });
      }
    }
    const tokens = new Map<string, Asset>();
    for (const t of inputs.tokens) if (t.contract) tokens.set(t.contract, t);
    for (const c of LIQUID_STAKING_CONTRACTS) if (!tokens.has(c)) tokens.set(c, { symbol: c === "meta-pool.near" ? "STNEAR" : "LINEAR", contract: c, decimals: 24 });
    for (const [contract, asset] of tokens) {
      onProgress?.(`  ft_balance_of ${contract} @${block.height}…`);
      let raw: unknown;
      try {
        raw = await viewAtBlock(contract, "ft_balance_of", { account_id: inputs.accountId }, block.height, onProgress);
      } catch (e) {
        // A token contract that did not exist yet at that block holds no balance for anyone.
        if (e instanceof Error && /UNKNOWN_ACCOUNT|does not exist|CodeDoesNotExist|MethodNotFound/i.test(e.message)) continue;
        throw e;
      }
      const units = BigInt(String(raw));
      if (units > BigInt(0)) balances.push({ asset, qty: formatUnits(units, asset.decimals), source: `ft_balance_of @${block.height}` });
    }
  }

  const position: OpeningPosition = {
    schemaVersion: 1,
    accountId: inputs.accountId,
    date,
    block: { height: block.height, hash: block.hash, timestampNs: block.timestampNs.toString() },
    accountExisted: state !== null,
    balances,
    fetchedAt: new Date().toISOString(),
    method: state
      ? "archival view_account + ft_balance_of at the first block of the year; staked NEAR from pool snapshots"
      : "account did not exist at the first block of the year (view_account UNKNOWN_ACCOUNT): no opening balances",
  };
  await writeJson(cacheFile, position);
  return position;
}
