import { z } from "zod";
import { NS_PER_MS, ZERO, absBig, formatUnits, parseUnits } from "./amount";
import { resolveFtMetadata } from "./ft-metadata";
import { NEARBLOCKS_SOURCE, fetchAllInRange, type ProgressFn, type RangeNs } from "./nearblocks";
import { NEAR_ASSET, type Direction, type HistoryResult, type NormalizedTx, type TxKind } from "./types";

// ---------- indexer row shapes (validated; the original row is kept as `raw`) ----------

const intStr = z.string().regex(/^-?\d+$/);

const ReceiptRow = z.object({
  receipt_id: z.string(),
  transaction_hash: z.string().nullable(),
  predecessor_account_id: z.string(),
  receiver_account_id: z.string(),
  actions: z.array(z.object({ action: z.string(), method: z.string().nullable().optional() })),
  actions_agg: z.object({ deposit: intStr }),
  outcome: z.object({ status: z.boolean().nullable() }),
  block: z.object({ block_timestamp: intStr }),
});
type ReceiptRow = z.infer<typeof ReceiptRow>;

const StakingRow = z.object({
  account: z.string(),
  amount: intStr,
  contract: z.string(),
  receipt_id: z.string(),
  transaction_hash: z.string().nullable(),
  type: z.string(),
  block_timestamp: intStr,
});
type StakingRow = z.infer<typeof StakingRow>;

const FtRow = z.object({
  affected_account_id: z.string(),
  involved_account_id: z.string().nullable(),
  delta_amount: intStr,
  cause: z.string(),
  contract_account_id: z.string(),
  event_index: z.union([z.number(), z.string()]),
  receipt_id: z.string(),
  transaction_hash: z.string().nullable(),
  block_timestamp: intStr,
  meta: z.object({ symbol: z.unknown().optional(), decimals: z.unknown().optional() }).nullable().optional(),
  outcomes: z.object({ status: z.boolean().nullable() }).optional(),
});
type FtRow = z.infer<typeof FtRow>;

function validated<S extends z.ZodType>(schema: S, rows: unknown[], label: string): { row: z.infer<S>; raw: unknown }[] {
  return rows.map((raw, i) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`${label} row ${i} has an unexpected shape: ${parsed.error.message}\n${JSON.stringify(raw).slice(0, 500)}`);
    }
    return { row: parsed.data, raw };
  });
}

// ---------- range ----------

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** `from` is inclusive. `to` is inclusive: a date covers that whole UTC day; a datetime covers up to that millisecond. */
export function resolveRange(fromISO: string, toISO: string): RangeNs {
  const toMs = (s: string, isEnd: boolean): number => {
    if (DATE_ONLY.test(s)) {
      const ms = Date.parse(`${s}T00:00:00Z`);
      if (Number.isNaN(ms)) throw new Error(`Invalid date: ${s}`);
      return isEnd ? ms + 86_400_000 : ms;
    }
    if (DATE_TIME.test(s)) {
      const ms = Date.parse(s);
      if (Number.isNaN(ms)) throw new Error(`Invalid datetime: ${s}`);
      return isEnd ? ms + 1 : ms;
    }
    throw new Error(`Expected YYYY-MM-DD or an ISO 8601 datetime with timezone, got "${s}"`);
  };
  const start = BigInt(toMs(fromISO, false)) * NS_PER_MS;
  const endExclusive = BigInt(toMs(toISO, true)) * NS_PER_MS;
  if (endExclusive <= start) throw new Error(`Empty range: ${fromISO} .. ${toISO}`);
  return { start, endExclusive };
}

const nsToISO = (ns: bigint): string => new Date(Number(ns / NS_PER_MS)).toISOString();

// ---------- classification ----------

const ACCOUNT_ID_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export function isValidAccountId(id: string): boolean {
  return ACCOUNT_ID_RE.test(id);
}

/** Validator staking-pool factories on mainnet (poolv1.near, pool.near, poolv2.near). */
const STAKING_POOL_RE = /\.(poolv1|pool|poolv2)\.near$/;
const STAKING_METHOD_KIND: Record<string, TxKind> = {
  deposit_and_stake: "stake",
  deposit: "stake",
  stake: "stake",
  stake_all: "stake",
  unstake: "unstake",
  unstake_all: "unstake",
  withdraw: "withdraw_stake",
  withdraw_all: "withdraw_stake",
};

/** Distinct function-call method names of a receipt, comma-joined, or null. */
function methodsOf(receipt: ReceiptRow | undefined): string | null {
  const names = (receipt?.actions ?? []).map((a) => a.method).filter((m): m is string => !!m);
  return names.length ? [...new Set(names)].join(",") : null;
}

function directionFor(accountId: string, predecessor: string, receiver: string): Direction | null {
  const fromMe = predecessor === accountId;
  const toMe = receiver === accountId;
  if (fromMe && toMe) return "self";
  if (fromMe) return "out";
  if (toMe) return "in";
  return null;
}

interface Built extends Omit<NormalizedTx, "id"> {
  baseId: string;
}

function normalizeStaking(rows: { row: StakingRow; raw: unknown }[], receiptsById: Map<string, ReceiptRow>): Built[] {
  const byReceipt = new Map<string, { row: StakingRow; raw: unknown }[]>();
  for (const r of rows) {
    const list = byReceipt.get(r.row.receipt_id) ?? [];
    list.push(r);
    byReceipt.set(r.row.receipt_id, list);
  }

  const out: Built[] = [];
  for (const [receiptId, group] of byReceipt) {
    const receipt = receiptsById.get(receiptId);
    const method = methodsOf(receipt);
    const success = receipt ? receipt.outcome.status === true : true;
    const deposit = group.find((g) => g.row.type === "DEPOSIT");
    const common = (g: { row: StakingRow; raw: unknown }) => ({
      txHash: g.row.transaction_hash ?? "",
      timestamp: nsToISO(BigInt(g.row.block_timestamp)),
      asset: NEAR_ASSET,
      amount: formatUnits(absBig(parseUnits(g.row.amount)), NEAR_ASSET.decimals),
      counterparty: g.row.contract,
      method,
      success,
      source: `${NEARBLOCKS_SOURCE}:staking-txns`,
    });

    if (deposit) {
      // deposit_and_stake emits DEPOSIT + STAKE for one receipt: NEAR left the wallet once, for the DEPOSIT amount.
      out.push({
        ...common(deposit),
        baseId: `nearblocks:staking:${receiptId}:DEPOSIT`,
        kind: "stake",
        direction: "out",
        raw: group.map((g) => g.raw),
      });
      continue;
    }
    for (const g of group) {
      const type = g.row.type;
      const [kind, direction]: [TxKind, Direction] =
        type === "STAKE" ? ["stake", "self"]
        : type === "UNSTAKE" ? ["unstake", "self"]
        : type === "WITHDRAW" ? ["withdraw_stake", "in"]
        : ["other", "self"];
      out.push({ ...common(g), baseId: `nearblocks:staking:${receiptId}:${type}`, kind, direction, raw: g.raw });
    }
  }
  return out;
}

function normalizeReceipts(
  accountId: string,
  rows: { row: ReceiptRow; raw: unknown }[],
  stakingReceiptIds: Set<string>,
  withdrawSettlements: Set<string>,
): Built[] {
  const out: Built[] = [];
  for (const { row, raw } of rows) {
    if (stakingReceiptIds.has(row.receipt_id)) continue; // represented by the staking record
    const pred = row.predecessor_account_id;
    const recv = row.receiver_account_id;
    const hasTransfer = row.actions.some((a) => a.action === "TRANSFER");
    // NEAR returned by a pool in a tx that has a WITHDRAW staking event is the withdraw_stake itself.
    if (hasTransfer && recv === accountId && withdrawSettlements.has(`${row.transaction_hash}|${pred}`)) continue;

    const direction = directionFor(accountId, pred, recv);
    if (!direction) continue; // receipt doesn't touch this account's balance

    const deposit = parseUnits(row.actions_agg.deposit, "actions_agg.deposit");
    const methods = row.actions.map((a) => a.method).filter((m): m is string => !!m);
    const method = methodsOf(row);
    const other = direction === "out" ? recv : direction === "in" ? pred : null;

    let kind: TxKind;
    if (pred === "system") {
      kind = "other"; // protocol gas / deposit refund
    } else if (row.actions.some((a) => a.action === "DELEGATE_ACTION")) {
      // Meta-tx wrapper delivered by a relayer. The indexer flattens the inner actions (and their deposit,
      // which the relayer pays) into it; the inner receipts sent by this account carry the real movement.
      kind = "other";
    } else if (direction === "out" && STAKING_POOL_RE.test(recv) && methods.length === 1 && STAKING_METHOD_KIND[methods[0]]) {
      // Staking call with no matching staking event (e.g. failed). Amount is the attached deposit only.
      kind = STAKING_METHOD_KIND[methods[0]];
    } else if (methods.length && deposit > ZERO) {
      kind = "function_call_with_deposit";
    } else if (hasTransfer) {
      kind = "native_transfer";
    } else {
      kind = "other";
    }

    out.push({
      baseId: `nearblocks:receipt:${row.receipt_id}`,
      txHash: row.transaction_hash ?? "",
      timestamp: nsToISO(BigInt(row.block.block_timestamp)),
      direction,
      kind,
      asset: NEAR_ASSET,
      amount: formatUnits(deposit, NEAR_ASSET.decimals),
      counterparty: other,
      method,
      success: row.outcome.status === true,
      source: `${NEARBLOCKS_SOURCE}:receipts`,
      raw,
    });
  }
  return out;
}

function normalizeFt(
  accountId: string,
  rows: { row: FtRow; raw: unknown }[],
  meta: Map<string, { symbol: string; decimals: number }>,
  receiptsById: Map<string, ReceiptRow>,
): Built[] {
  const out: Built[] = [];
  for (const { row, raw } of rows) {
    if (row.affected_account_id !== accountId) continue;
    const m = meta.get(row.contract_account_id);
    if (!m) throw new Error(`Missing metadata for ${row.contract_account_id}`);
    const delta = parseUnits(row.delta_amount, "delta_amount");
    const counterparty = row.involved_account_id;
    const direction: Direction = delta === ZERO || counterparty === accountId ? "self" : delta < ZERO ? "out" : "in";
    const receipt = receiptsById.get(row.receipt_id);
    out.push({
      baseId: `nearblocks:ft:${row.receipt_id}:${row.contract_account_id}:${row.event_index}`,
      txHash: row.transaction_hash ?? "",
      timestamp: nsToISO(BigInt(row.block_timestamp)),
      direction,
      kind: "ft_transfer",
      asset: { symbol: m.symbol, contract: row.contract_account_id, decimals: m.decimals },
      amount: formatUnits(absBig(delta), m.decimals),
      counterparty,
      method: methodsOf(receipt),
      // NEP-141 events are only logged by successful receipts.
      success: row.outcomes ? row.outcomes.status === true : true,
      source: `${NEARBLOCKS_SOURCE}:ft-txns`,
      raw,
    });
  }
  return out;
}

// ---------- public API ----------

export interface FetchHistoryOptions {
  onProgress?: ProgressFn;
}

/**
 * Fetch and normalize a NEAR mainnet account's history for [fromISO, toISO] (both inclusive).
 * Sources (NearBlocks v3): receipts (native NEAR + function calls), staking-txns, ft-txns.
 */
export async function fetchHistory(
  accountId: string,
  fromISO: string,
  toISO: string,
  options: FetchHistoryOptions = {},
): Promise<HistoryResult> {
  if (!isValidAccountId(accountId)) throw new Error(`Invalid NEAR account id: "${accountId}"`);
  const range = resolveRange(fromISO, toISO);
  const { onProgress } = options;
  const enc = encodeURIComponent(accountId);

  onProgress?.(`Fetching receipts for ${accountId}…`);
  const receipts = validated(
    ReceiptRow,
    await fetchAllInRange<ReceiptRow>({
      path: `/v3/accounts/${enc}/receipts`,
      range,
      timestampOf: (r) => BigInt(r.block.block_timestamp),
      onProgress,
    }),
    "receipts",
  );

  onProgress?.(`Fetching staking txns…`);
  const staking = validated(
    StakingRow,
    await fetchAllInRange<StakingRow>({
      path: `/v3/accounts/${enc}/staking-txns`,
      range,
      timestampOf: (r) => BigInt(r.block_timestamp),
      onProgress,
    }),
    "staking-txns",
  );

  onProgress?.(`Fetching FT transfers…`);
  const ft = validated(
    FtRow,
    await fetchAllInRange<FtRow>({
      path: `/v3/accounts/${enc}/ft-txns`,
      range,
      timestampOf: (r) => BigInt(r.block_timestamp),
      onProgress,
    }),
    "ft-txns",
  );

  const indexerMeta = new Map<string, { symbol?: unknown; decimals?: unknown }>();
  for (const { row } of ft) {
    if (!indexerMeta.has(row.contract_account_id)) indexerMeta.set(row.contract_account_id, row.meta ?? {});
  }
  onProgress?.(`Resolving metadata for ${indexerMeta.size} token contract(s) via RPC…`);
  const meta = await resolveFtMetadata(indexerMeta, onProgress);

  const receiptsById = new Map(receipts.map((r) => [r.row.receipt_id, r.row]));
  const stakingReceiptIds = new Set(staking.map((s) => s.row.receipt_id));
  const withdrawSettlements = new Set(
    staking.filter((s) => s.row.type === "WITHDRAW").map((s) => `${s.row.transaction_hash}|${s.row.contract}`),
  );

  const built = [
    ...normalizeReceipts(accountId, receipts, stakingReceiptIds, withdrawSettlements),
    ...normalizeStaking(staking, receiptsById),
    ...normalizeFt(accountId, ft, meta, receiptsById),
  ];

  // Stable unique ids even if the indexer emits two rows with the same natural key.
  const seen = new Map<string, number>();
  const records: NormalizedTx[] = built.map(({ baseId, ...rest }) => {
    const n = seen.get(baseId) ?? 0;
    seen.set(baseId, n + 1);
    return { id: n === 0 ? baseId : `${baseId}#${n}`, ...rest };
  });
  records.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.id < b.id ? -1 : 1));

  return {
    accountId,
    from: fromISO,
    to: toISO,
    rangeNs: { start: range.start.toString(), endExclusive: range.endExclusive.toString() },
    fetchedAt: new Date().toISOString(),
    source: NEARBLOCKS_SOURCE,
    records,
  };
}
