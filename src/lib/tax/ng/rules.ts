/**
 * Deterministic classification rules, applied before any AI. Each rule returns
 * { label, confidence: 1, method: "rule", reason } for the records it is certain about.
 */
import { STAKING_POOL_RE } from "../../history/pools";
import { toUnits } from "../../history/summary";
import type { NormalizedTx } from "../../history/types";
import { CONTRACTS, DEX_CONTRACTS, LIQUID_STAKING_CONTRACTS, costBasisAsset, type LabelId } from "./labels";

export interface RuleMatch {
  label: LabelId;
  confidence: 1;
  method: "rule";
  reason: string;
  rule: string;
  pairingId?: string;
  swapRole?: "disposed" | "acquired";
}

export interface RuleContext {
  accountId: string;
  /** Other accounts the user declares as their own. */
  ownAccounts: string[];
}

const match = (rule: string, label: LabelId, reason: string, extra: Partial<RuleMatch> = {}): RuleMatch => ({
  label,
  confidence: 1,
  method: "rule",
  reason,
  rule,
  ...extra,
});

const methodHas = (tx: NormalizedTx, name: string) => (tx.method ?? "").split(",").includes(name);
const sym = (tx: NormalizedTx) => tx.asset.symbol;

// ---------- single-record rules ----------

export function ruleStakingReward(tx: NormalizedTx): RuleMatch | null {
  if (tx.kind !== "staking_reward") return null;
  return match("staking_reward", "income_staking_reward", `Daily staking reward from ${tx.counterparty} derived from pool balance snapshots (D3).`);
}

export function ruleStakingLockup(tx: NormalizedTx): RuleMatch | null {
  if (tx.kind !== "stake" && tx.kind !== "unstake" && tx.kind !== "withdraw_stake") return null;
  if (!tx.counterparty || !STAKING_POOL_RE.test(tx.counterparty)) return null;
  return match("staking_lockup", "staking_lockup", `${tx.kind} of own NEAR with validator pool ${tx.counterparty}${tx.method ? ` (${tx.method})` : ""}; no change of ownership.`);
}

export function ruleGasRefund(tx: NormalizedTx): RuleMatch | null {
  if (tx.counterparty !== "system" || tx.direction !== "in") return null;
  return match("gas_refund", "gas_refund", "Protocol refund from 'system' (unused gas or returned deposit).");
}

export function ruleOwnWallet(tx: NormalizedTx, ctx: RuleContext): RuleMatch | null {
  if (!tx.counterparty || tx.counterparty === ctx.accountId) return null;
  if (!ctx.ownAccounts.includes(tx.counterparty)) return null;
  if (tx.kind !== "native_transfer" && tx.kind !== "ft_transfer" && tx.kind !== "function_call_with_deposit") return null;
  return match("own_wallet", "own_wallet_transfer", `${tx.direction === "out" ? "To" : "From"} ${tx.counterparty}, declared as the user's own account.`);
}

export function ruleLiquidStaking(tx: NormalizedTx): RuleMatch | null {
  const lstDirect = tx.counterparty !== null && LIQUID_STAKING_CONTRACTS.has(tx.counterparty);
  const lstMintBurn = tx.asset.contract !== null && LIQUID_STAKING_CONTRACTS.has(tx.asset.contract) && tx.counterparty === null;
  if (!lstDirect && !lstMintBurn) return null;
  if (lstDirect && tx.kind !== "native_transfer" && tx.kind !== "function_call_with_deposit" && tx.kind !== "ft_transfer") return null;
  const contract = lstDirect ? tx.counterparty! : tx.asset.contract!;
  return match(
    "liquid_staking",
    "defi_receipt",
    `Liquid-staking ${tx.direction === "out" ? "deposit/redemption leg to" : "receipt/payout from"} ${contract}${tx.method ? ` (${tx.method})` : ""}; receipt token, accrual taxed on disposal (D4).`,
  );
}

// ---------- transaction-level rules ----------

function byTx(records: NormalizedTx[]): Map<string, NormalizedTx[]> {
  const m = new Map<string, NormalizedTx[]>();
  for (const r of records) {
    if (!r.txHash) continue;
    const list = m.get(r.txHash) ?? [];
    list.push(r);
    m.set(r.txHash, list);
  }
  return m;
}

/**
 * wrap.near near_deposit / near_withdraw: the native NEAR leg to/from wrap.near and the
 * matching wNEAR mint/burn leg (counterparty null) in the same transaction.
 */
export function ruleWrapUnwrap(records: NormalizedTx[]): Map<string, RuleMatch> {
  const out = new Map<string, RuleMatch>();
  for (const legs of byTx(records).values()) {
    const wraps = legs.some((l) => methodHas(l, "near_deposit") && (l.counterparty === CONTRACTS.wNEAR || l.asset.contract === CONTRACTS.wNEAR));
    const unwraps = legs.some((l) => methodHas(l, "near_withdraw") && (l.counterparty === CONTRACTS.wNEAR || l.asset.contract === CONTRACTS.wNEAR));
    if (!wraps && !unwraps) continue;
    const op = wraps ? "near_deposit (wrap NEAR -> wNEAR)" : "near_withdraw (unwrap wNEAR -> NEAR)";
    for (const l of legs) {
      const nativeLeg = l.asset.contract === null && l.counterparty === CONTRACTS.wNEAR;
      const wnearMintBurn = l.asset.contract === CONTRACTS.wNEAR && l.counterparty === null;
      if (nativeLeg || wnearMintBurn) {
        out.set(l.id, match("wrap_unwrap", "wrap_unwrap", `wrap.near ${op}: ${l.direction} ${l.amount} ${sym(l)}; same asset for cost base.`));
      }
    }
  }
  return out;
}

const isOutLeg = (l: NormalizedTx) =>
  l.direction === "out" &&
  l.success &&
  l.amount !== "0" &&
  (l.kind === "ft_transfer" ||
    l.kind === "native_transfer" ||
    (l.kind === "function_call_with_deposit" && l.counterparty !== null && DEX_CONTRACTS.has(l.counterparty)));

const isInLeg = (l: NormalizedTx) =>
  l.direction === "in" && l.success && l.amount !== "0" && l.counterparty !== "system" && (l.kind === "ft_transfer" || l.kind === "native_transfer");

/**
 * Swap pairing: in one transaction, an outgoing leg of asset A and an incoming leg of a
 * different asset B (wNEAR and NEAR count as the same asset). Outgoing legs of assets not
 * received back are `disposal_swap` (disposed); incoming legs of assets not given are linked
 * as the acquisition side with the same pairingId. Same-asset legs (e.g. refunds) are left alone.
 */
export function ruleSwapPairing(records: NormalizedTx[], alreadyMatched: Set<string>): Map<string, RuleMatch> {
  const out = new Map<string, RuleMatch>();
  for (const [txHash, legs] of byTx(records)) {
    const free = legs.filter((l) => !alreadyMatched.has(l.id));
    const outs = free.filter(isOutLeg);
    const ins = free.filter(isInLeg);
    if (!outs.length || !ins.length) continue;
    const outAssets = new Set(outs.map((l) => costBasisAsset(l.asset)));
    const inAssets = new Set(ins.map((l) => costBasisAsset(l.asset)));
    const disposed = outs.filter((l) => !inAssets.has(costBasisAsset(l.asset)));
    const acquired = ins.filter((l) => !outAssets.has(costBasisAsset(l.asset)));
    if (!disposed.length || !acquired.length) continue;

    const pairingId = `swap:${txHash}`;
    const venues = [...new Set([...disposed, ...acquired].map((l) => l.counterparty).filter((c): c is string => !!c))];
    const venue = venues.map((v) => (DEX_CONTRACTS.has(v) ? `${v} (${DEX_CONTRACTS.get(v)})` : v)).join(", ");
    const gave = disposed.map((l) => `${l.amount} ${sym(l)}`).join(" + ");
    const got = acquired.map((l) => `${l.amount} ${sym(l)}`).join(" + ");
    for (const l of disposed) {
      out.set(l.id, match("swap", "disposal_swap", `Swap leg given up: ${gave} for ${got} via ${venue}; proceeds = FMV of asset given up (D1).`, { pairingId, swapRole: "disposed" }));
    }
    for (const l of acquired) {
      out.set(l.id, match("swap", "acquisition_swap", `Swap leg acquired: ${got} in exchange for ${gave} via ${venue}; cost base = FMV of asset given up (D1).`, { pairingId, swapRole: "acquired" }));
    }
  }
  return out;
}

// ---------- technical non-taxable rules (D12) ----------

/** Amounts below this many smallest units of the asset (yocto for NEAR) are dust. */
export const DUST_THRESHOLD_UNITS = BigInt(1000);

/** Zero or < 1000 smallest-unit amounts. Never applied to staking rewards. */
export function ruleDust(tx: NormalizedTx): RuleMatch | null {
  if (tx.kind === "staking_reward") return null;
  const units = toUnits(tx.amount, tx.asset.decimals);
  if (units >= DUST_THRESHOLD_UNITS) return null;
  return match(
    "dust",
    "dust_no_value",
    units === BigInt(0)
      ? `Zero-value ${tx.kind}${tx.method ? ` (${tx.method})` : ""}; no economic movement.`
      : `${units} smallest units of ${sym(tx)} (${tx.amount}); negligible, e.g. the 1 yoctoNEAR ft_transfer security deposit.`,
  );
}

const sameAsset = (a: NormalizedTx, b: NormalizedTx) => a.asset.contract === b.asset.contract && (a.asset.contract !== null || a.asset.symbol === b.asset.symbol);

/**
 * Within one transaction, an outgoing and an incoming leg of the same asset (same contract, or both
 * native) with the same exact amount: a round trip (e.g. a failed swap refunding its input). Legs are
 * matched one-to-one. Runs before swap pairing.
 */
export function ruleRoundTrip(records: NormalizedTx[], alreadyMatched: Set<string>): Map<string, RuleMatch> {
  const out = new Map<string, RuleMatch>();
  for (const legs of byTx(records).values()) {
    const free = legs.filter((l) => !alreadyMatched.has(l.id) && l.success && l.kind !== "staking_reward");
    const ins = free.filter((l) => l.direction === "in");
    const used = new Set<string>();
    for (const o of free.filter((l) => l.direction === "out")) {
      const back = ins.find((i) => !used.has(i.id) && sameAsset(o, i) && i.amount === o.amount);
      if (!back) continue;
      used.add(back.id);
      const why = `${o.amount} ${sym(o)} sent to ${o.counterparty ?? "(none)"} and the same amount returned from ${back.counterparty ?? "(none)"} in the same transaction`;
      out.set(o.id, match("round_trip", "round_trip", `Round trip: ${why}.`));
      out.set(back.id, match("round_trip", "round_trip", `Round trip (return leg): ${why}.`));
    }
  }
  return out;
}

const STORAGE_METHOD_RE = /(^|_)storage_(deposit|withdraw|unregister)$/;
const isStorageDepositMethod = (m: string) => m === "storage_deposit" || m.endsWith("_storage_deposit");
const methods = (tx: NormalizedTx) => (tx.method ?? "").split(",").filter(Boolean);

/**
 * NEAR storage staking: outgoing storage_deposit (incl. *_storage_deposit variants such as
 * tokens_storage_deposit) and NEAR refunds from a contract the account called with a
 * storage_deposit / storage_withdraw / storage_unregister method in the same transaction.
 */
export function ruleStorageDeposit(records: NormalizedTx[], alreadyMatched: Set<string>): Map<string, RuleMatch> {
  const out = new Map<string, RuleMatch>();
  for (const legs of byTx(records).values()) {
    const storageContracts = new Set(
      legs.filter((l) => l.direction === "out" && l.counterparty && methods(l).some((m) => STORAGE_METHOD_RE.test(m))).map((l) => l.counterparty!),
    );
    if (!storageContracts.size) continue;
    for (const l of legs) {
      if (alreadyMatched.has(l.id) || l.asset.contract !== null) continue;
      if (l.direction === "out" && l.counterparty && storageContracts.has(l.counterparty) && methods(l).some(isStorageDepositMethod)) {
        out.set(l.id, match("storage_deposit", "storage_deposit", `Refundable storage deposit of ${l.amount} NEAR to ${l.counterparty} (${l.method}).`));
      } else if (l.direction === "in" && l.counterparty && storageContracts.has(l.counterparty)) {
        out.set(l.id, match("storage_deposit", "storage_deposit", `Storage deposit refund of ${l.amount} NEAR from ${l.counterparty} in the same transaction.`));
      }
    }
  }
  return out;
}

// ---------- DeFi harvest / claim (D13) ----------

export const HARVEST_METHOD_RE = /harvest|claim|claim_reward|withdraw_reward/i;

/**
 * An incoming fungible-token leg in a transaction where the account itself called a
 * harvest/claim-style method on a contract, coming from that contract (or minted, counterparty
 * null, by that contract or as a result of the call) -> income_defi_yield.
 */
export function ruleDefiHarvest(records: NormalizedTx[], alreadyMatched: Set<string>): Map<string, RuleMatch> {
  const out = new Map<string, RuleMatch>();
  for (const legs of byTx(records).values()) {
    const called = new Set(
      legs
        .filter((l) => l.direction === "out" && l.counterparty && methods(l).some((m) => HARVEST_METHOD_RE.test(m)))
        .map((l) => l.counterparty!),
    );
    if (!called.size) continue;
    for (const l of legs) {
      if (alreadyMatched.has(l.id) || l.direction !== "in" || l.kind !== "ft_transfer" || !l.success) continue;
      const fromCalled = l.counterparty !== null && called.has(l.counterparty);
      const minted = l.counterparty === null;
      if (!fromCalled && !minted) continue;
      const via = [...called].join(", ");
      out.set(l.id, match("defi_harvest", "income_defi_yield", `${l.amount} ${sym(l)} received after the account called ${l.method ?? "a harvest/claim method"} on ${via}; DeFi yield, income at FMV on receipt.`));
    }
  }
  return out;
}

// ---------- all rules, in order ----------

/**
 * Apply every rule in priority order; the first match for a record wins:
 * staking reward, pool lockup, system refund, own wallet, dust, round trip, storage deposit,
 * DeFi harvest, wrap/unwrap, liquid staking, swap pairing.
 */
export function applyRules(records: NormalizedTx[], ctx: RuleContext): Map<string, RuleMatch> {
  const result = new Map<string, RuleMatch>();
  const single = [ruleStakingReward, ruleStakingLockup, ruleGasRefund, (tx: NormalizedTx) => ruleOwnWallet(tx, ctx), ruleDust];
  for (const tx of records) {
    for (const rule of single) {
      const m = rule(tx);
      if (m) {
        result.set(tx.id, m);
        break;
      }
    }
  }
  for (const [id, m] of ruleRoundTrip(records, new Set(result.keys()))) result.set(id, m);
  for (const [id, m] of ruleStorageDeposit(records, new Set(result.keys()))) result.set(id, m);
  for (const [id, m] of ruleDefiHarvest(records, new Set(result.keys()))) result.set(id, m);
  for (const [id, m] of ruleWrapUnwrap(records.filter((r) => !result.has(r.id)))) result.set(id, m);
  for (const tx of records) {
    if (result.has(tx.id)) continue;
    const m = ruleLiquidStaking(tx);
    if (m) result.set(tx.id, m);
  }
  for (const [id, m] of ruleSwapPairing(records, new Set(result.keys()))) result.set(id, m);
  return result;
}
