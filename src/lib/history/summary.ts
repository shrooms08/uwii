import { ZERO, formatUnits } from "./amount";
import type { NormalizedTx, TxKind } from "./types";

export const KINDS: TxKind[] = [
  "native_transfer",
  "ft_transfer",
  "stake",
  "unstake",
  "withdraw_stake",
  "function_call_with_deposit",
  "other",
];

export const assetKey = (tx: NormalizedTx) =>
  tx.asset.contract ? `${tx.asset.symbol} (${tx.asset.contract})` : tx.asset.symbol;

export interface KindCount {
  kind: TxKind;
  total: number;
  failed: number;
}

export interface AssetSummary {
  asset: string;
  decimals: number;
  total: number;
  failed: number;
  /** Sums of successful records only. Exact decimal strings. */
  in: string;
  out: string;
}

export function countsByKind(records: NormalizedTx[]): KindCount[] {
  return KINDS.map((kind) => {
    const of = records.filter((r) => r.kind === kind);
    return { kind, total: of.length, failed: of.filter((r) => !r.success).length };
  });
}

/** Parse an exact decimal string back to base units. */
function toUnits(amount: string, decimals: number): bigint {
  const [whole, frac = ""] = amount.split(".");
  return BigInt(whole + frac.padEnd(decimals, "0"));
}

export function summarizeByAsset(records: NormalizedTx[]): AssetSummary[] {
  const map = new Map<string, { decimals: number; total: number; failed: number; in: bigint; out: bigint }>();
  for (const r of records) {
    const key = assetKey(r);
    const s = map.get(key) ?? { decimals: r.asset.decimals, total: 0, failed: 0, in: ZERO, out: ZERO };
    s.total++;
    if (!r.success) s.failed++;
    else if (r.direction === "in") s.in += toUnits(r.amount, r.asset.decimals);
    else if (r.direction === "out") s.out += toUnits(r.amount, r.asset.decimals);
    map.set(key, s);
  }
  return [...map.entries()]
    .map(([asset, s]) => ({
      asset,
      decimals: s.decimals,
      total: s.total,
      failed: s.failed,
      in: formatUnits(s.in, s.decimals),
      out: formatUnits(s.out, s.decimals),
    }))
    .sort((a, b) => b.total - a.total || a.asset.localeCompare(b.asset));
}
