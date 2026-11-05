/**
 * Nigerian virtual-asset tax engine — NRS Information Circular 2026/21, decisions D1-D14
 * (docs/rules-ng-2026-21.md). Dollar-referenced gains (9.1.2), FIFO (D5, 9.3.3(3)), CBN NFEM
 * rates (D8), PIT bands (D6). Full precision throughout; rounding happens only at presentation.
 */
import type { FxQuote, NafemTable } from "../../fx/nafem";
import { Dec, ZERO_D, dec, full } from "../../money";
import type { PriceProvider, PriceResult } from "../../prices/provider";
import type { Asset } from "../../history/types";
import { LABELS, costBasisAsset, type LabelId } from "./labels";
import type { OpeningBalance } from "./opening";
import { RESET_PRICE_TIME } from "./opening";
import { pit, type PitBandUse } from "./pit";
import type { ClassifiedTx } from "./types";

// ---------- types ----------

export type LineKind =
  | "opening"
  | "income"
  | "acquisition"
  | "disposal"
  | "gas_fee"
  | "transfer_out"
  | "transfer_in"
  | "gift_out"
  | "gift_in"
  | "loan"
  | "receipt_token"
  | "excluded";

export interface ReportLine {
  date: string;
  timestamp: string;
  recordId: string | null;
  txHash: string;
  label: string;
  kind: LineKind;
  asset: string;
  assetKey: string;
  qty: string;
  usdPrice: string | null;
  priceGranularity: string | null;
  priceSource: string | null;
  priceMethod: string | null;
  priceStatus: "ok" | "no_verifiable_price" | "not_needed";
  /** qty x USD price (FMV). */
  usdValue: string | null;
  proceedsUsd?: string;
  costUsd?: string;
  gainUsd?: string;
  /** D1: FMV of the asset received in the same swap (stored alongside proceeds = FMV given up). */
  fmvReceivedUsd?: string;
  /** D11: cost and gain without the pre-2026 reset, when opening lots were consumed. */
  noResetCostUsd?: string;
  noResetGainUsd?: string;
  nafemRate: string | null;
  rateDate: string | null;
  rateFallback: boolean;
  /** NGN value of the line (usdValue, proceeds or income) at the NFEM rate. */
  ngnValue: string | null;
  incomeUsd?: string;
  incomeNgn?: string;
  gainNgn?: string;
  circularRef: string;
  method: string;
  includedInTotals: boolean;
  notes: string[];
}

export interface Warning {
  code: string;
  message: string;
  recordId?: string;
  txHash?: string;
}

export interface LotView {
  assetKey: string;
  asset: string;
  qty: string;
  costUsd: string;
  acquiredAt: string;
  origin: string;
  resetCostUsd?: string;
  originalCostUsd?: string | null;
}

export interface EngineResult {
  year: number;
  lines: ReportLine[];
  totals: {
    totalVaIncomeUsd: string;
    totalVaIncomeNgn: string;
    disposalGainsNgn: string;
    disposalLossesNgn: string;
    netGainsNgn: string;
    gasFeesUsd: string;
    gasFeesNgn: string;
    chargeableVaNgn: string;
    linesIncluded: number;
    linesExcluded: number;
  };
  carryForwardLossNgn: string;
  tax: {
    otherIncomeNgn: string | null;
    basis: "marginal_over_other_income" | "standalone";
    pitWithVaNgn: string;
    pitWithoutVaNgn: string;
    taxAttributableToVaNgn: string;
    bands: PitBandUse[];
    notes: string[];
  };
  warnings: Warning[];
  decisionsApplied: { id: string; text: string }[];
  openingLots: LotView[];
  closingLots: LotView[];
  skippedTechnical: Record<string, number>;
}

export interface EngineInput {
  year: number;
  records: ClassifiedTx[];
  prices: PriceProvider;
  fx: NafemTable;
  /** Balances at the first block of the year (D11). */
  openingBalances: OpeningBalance[];
  /** Optional user-provided original dollar cost per cost-basis asset key ("NEAR" or contract). */
  originalCostUsd?: Record<string, string>;
  otherIncomeNgn?: string | null;
}

// ---------- decisions ----------

const DECISIONS: Record<string, string> = {
  D1: "Swap proceeds = dollar FMV of asset given up (9.3.2, Illustration 3); FMV of asset received stored too.",
  D2: "Gas fees on signed transactions are NEAR disposals at FMV (7.1 event 5); not deductible; shown separately.",
  D3: "Native staking rewards recognised daily on receipt as income (7.1 event 9; 9.5(4)).",
  D4: "Liquid-staking deposit is a receipt (10.2); cost carried to the receipt token.",
  D5: "FIFO cost method (9.3.3(3)); NEAR and wNEAR share one lot pool (10.1).",
  D6: "PIT bands: 0% to 800k; 15% next 2.2m; 18% next 9m; 21% next 13m; 23% next 25m; 25% above 50m.",
  D7: "USD prices from CoinGecko historical (hourly where available); primary trading pair otherwise (9.2(1)).",
  D8: "USD/NGN at the CBN NFEM (NAFEM) closing rate on the transaction date; prior published date if none (never interpolated).",
  D9: "Gift received: cost base = market value at receipt (NTA s.36(1)); gift given: no tax on donor.",
  D11: "Pre-2026 holdings: cost base = higher of original cost or FMV at 2025-12-31 23:59:59 UTC; both gains shown.",
  D13: "Loan received is a liability (no income); loan repaid in a different asset is flagged.",
  D14: "User answers applied as method 'user' labels.",
};

const TECHNICAL: ReadonlySet<LabelId> = new Set(["wrap_unwrap", "staking_lockup", "round_trip", "dust_no_value", "storage_deposit", "gas_refund", "loan_collateralised"]);
const INCOME: ReadonlySet<LabelId> = new Set(["income_professional_fees", "income_employment", "income_business", "income_staking_reward", "income_defi_yield", "income_airdrop"]);
const GAS_FEE_REF = "7.1 event 5 (D2: gas fee is a NEAR disposal; not deductible)";

// ---------- lots ----------

interface Lot {
  qty: Dec;
  cost: Dec;
  acquiredAt: string;
  origin: string;
  /** Opening (pre-2026) lot: cost = max(original, reset). */
  opening?: { resetCost: Dec; originalCost: Dec | null };
}

interface Consumption {
  cost: Dec;
  /** Cost without the D11 reset; null if an opening lot without a known original cost was consumed. */
  noResetCost: Dec | null;
  usedOpening: boolean;
  shortfall: Dec;
}

class LotBook {
  private readonly pools = new Map<string, Lot[]>();

  add(key: string, lot: Lot) {
    if (lot.qty.lte(0)) return;
    const list = this.pools.get(key) ?? [];
    list.push(lot);
    this.pools.set(key, list);
  }

  /** FIFO removal of `qty`; returns the cost removed. */
  consume(key: string, qty: Dec): Consumption {
    const list = this.pools.get(key) ?? [];
    let need = qty;
    let cost = ZERO_D;
    let noReset: Dec | null = ZERO_D;
    let usedOpening = false;
    while (need.gt(0) && list.length) {
      const lot = list[0];
      const take = Dec.min(need, lot.qty);
      const share = lot.cost.mul(take).div(lot.qty);
      cost = cost.plus(share);
      if (lot.opening) {
        usedOpening = true;
        noReset = noReset === null || lot.opening.originalCost === null ? null : noReset.plus(lot.opening.originalCost.mul(take).div(lot.qty));
        if (lot.opening.originalCost !== null) lot.opening.originalCost = lot.opening.originalCost.minus(lot.opening.originalCost.mul(take).div(lot.qty));
        lot.opening.resetCost = lot.opening.resetCost.minus(lot.opening.resetCost.mul(take).div(lot.qty));
      } else if (noReset !== null) {
        noReset = noReset.plus(share);
      }
      lot.cost = lot.cost.minus(share);
      lot.qty = lot.qty.minus(take);
      need = need.minus(take);
      if (lot.qty.lte(0)) list.shift();
    }
    return { cost, noResetCost: noReset, usedOpening, shortfall: need.gt(0) ? need : ZERO_D };
  }

  view(symbols: Map<string, string>): LotView[] {
    const out: LotView[] = [];
    for (const [key, list] of this.pools) {
      for (const l of list) {
        out.push({
          assetKey: key,
          asset: symbols.get(key) ?? key,
          qty: full(l.qty),
          costUsd: full(l.cost),
          acquiredAt: l.acquiredAt,
          origin: l.origin,
          ...(l.opening ? { resetCostUsd: full(l.opening.resetCost), originalCostUsd: l.opening.originalCost ? full(l.opening.originalCost) : null } : {}),
        });
      }
    }
    return out;
  }
}

// ---------- engine ----------

const dateOf = (ts: string) => ts.slice(0, 10);

export async function runEngine(input: EngineInput): Promise<EngineResult> {
  const { prices, fx } = input;
  const lots = new LotBook();
  const symbols = new Map<string, string>();
  const lines: ReportLine[] = [];
  const warnings: Warning[] = [];
  const used = new Set<string>();
  const skippedTechnical: Record<string, number> = {};
  const loanAssetsByCounterparty = new Map<string, Set<string>>();
  const receiptCarry = new Map<string, Dec>(); // txHash -> cost carried by defi_receipt out legs

  const warn = (code: string, message: string, r?: ClassifiedTx) =>
    warnings.push({ code, message, ...(r ? { recordId: r.id, txHash: r.txHash } : {}) });
  const keyOf = (a: Asset) => {
    const k = costBasisAsset(a);
    symbols.set(k, k === "NEAR" ? "NEAR" : a.symbol);
    return k;
  };

  const priceCache = new Map<string, Promise<PriceResult>>();
  const priceOf = (asset: Asset, ts: string) => {
    const k = `${asset.contract ?? "native"}|${ts}`;
    if (!priceCache.has(k)) priceCache.set(k, prices.quote(asset, ts));
    return priceCache.get(k)!;
  };
  const fxOf = (date: string): FxQuote | null => {
    try {
      return fx.quote(date);
    } catch (e) {
      warnings.push({ code: "no_fx_rate", message: e instanceof Error ? e.message : String(e) });
      return null;
    }
  };

  function baseLine(r: ClassifiedTx | null, p: { ts: string; label: string; kind: LineKind; asset: Asset; qty: string; circularRef: string; method: string }): ReportLine {
    return {
      date: dateOf(p.ts),
      timestamp: p.ts,
      recordId: r?.id ?? null,
      txHash: r?.txHash ?? "",
      label: p.label,
      kind: p.kind,
      asset: p.asset.symbol,
      assetKey: keyOf(p.asset),
      qty: p.qty,
      usdPrice: null,
      priceGranularity: null,
      priceSource: null,
      priceMethod: null,
      priceStatus: "not_needed",
      usdValue: null,
      nafemRate: null,
      rateDate: null,
      rateFallback: false,
      ngnValue: null,
      circularRef: p.circularRef,
      method: p.method,
      includedInTotals: true,
      notes: [],
    };
  }

  /** Fill price + FMV; returns FMV (USD) or null when no verifiable price (9.2(4)). */
  async function withPrice(line: ReportLine, asset: Asset, ts: string, r: ClassifiedTx | null): Promise<Dec | null> {
    const pr = await priceOf(asset, ts);
    if (pr.status !== "ok") {
      line.priceStatus = "no_verifiable_price";
      line.priceMethod = pr.attempted.join(" | ");
      line.notes.push(`no verifiable price (9.2(4)); attempted: ${pr.attempted.join("; ")}`);
      if (r) warn("no_verifiable_price", `${asset.symbol} ${line.qty} on ${line.date}: no verifiable price (9.2(4)); excluded from totals. Attempted: ${pr.attempted.join("; ")}`, r);
      return null;
    }
    line.priceStatus = "ok";
    line.usdPrice = pr.quote.usd;
    line.priceGranularity = pr.quote.granularity;
    line.priceSource = pr.quote.source;
    line.priceMethod = pr.quote.method;
    const fmv = dec(line.qty).mul(dec(pr.quote.usd));
    line.usdValue = full(fmv);
    used.add("D7");
    return fmv;
  }

  function withFx(line: ReportLine): Dec | null {
    const q = fxOf(line.date);
    if (!q) {
      line.includedInTotals = false;
      line.notes.push("no CBN NFEM rate on or before this date");
      return null;
    }
    line.nafemRate = q.rate;
    line.rateDate = q.rateDate;
    line.rateFallback = q.rateFallback;
    if (q.rateFallback) line.notes.push(`rate_fallback: no NFEM rate published on ${q.date}; used ${q.rateDate}`);
    used.add("D8");
    return dec(q.rate);
  }

  /** Record a disposal line: proceeds known (USD), FIFO cost from lots, gain in USD and NGN. */
  function settleDisposal(line: ReportLine, key: string, qty: Dec, proceeds: Dec | null, rate: Dec | null, r: ClassifiedTx | null) {
    const c = lots.consume(key, qty);
    used.add("D5");
    line.costUsd = full(c.cost);
    if (c.shortfall.gt(0)) {
      line.notes.push(`missing acquisition history for ${full(c.shortfall)} ${line.asset}: nil cost used`);
      warn("missing_acquisition_history", `${line.asset}: disposed ${line.qty} on ${line.date} but only ${full(qty.minus(c.shortfall))} in lots; nil cost used for ${full(c.shortfall)}`, r ?? undefined);
    }
    if (proceeds === null || rate === null) {
      line.includedInTotals = false;
      return;
    }
    const gain = proceeds.minus(c.cost);
    line.proceedsUsd = full(proceeds);
    line.gainUsd = full(gain);
    line.gainNgn = full(gain.mul(rate));
    line.ngnValue = full(proceeds.mul(rate));
    if (c.usedOpening) {
      used.add("D11");
      if (c.noResetCost) {
        line.noResetCostUsd = full(c.noResetCost);
        line.noResetGainUsd = full(proceeds.minus(c.noResetCost));
        line.notes.push("D11: consumed pre-2026 lots; reset gain is reported, no-reset gain shown alongside");
      } else {
        line.notes.push("D11: consumed pre-2026 lots without a user-provided original cost; no-reset gain not available");
      }
    }
  }

  // ---- opening lots (D11) ----
  const openingLots: LotView[] = [];
  for (const b of input.openingBalances) {
    const key = keyOf(b.asset);
    const line = baseLine(null, { ts: RESET_PRICE_TIME, label: "opening_position", kind: "opening", asset: b.asset, qty: b.qty, circularRef: "D11 (pre-2026 cost-base reset)", method: "opening" });
    const fmv = await withPrice(line, b.asset, RESET_PRICE_TIME, null);
    withFx(line);
    const original = input.originalCostUsd?.[key] ? dec(input.originalCostUsd[key]) : null;
    if (fmv === null) {
      warn("no_verifiable_price", `Opening ${b.asset.symbol} ${b.qty}: no verifiable price at ${RESET_PRICE_TIME}; reset value unknown, cost = ${original ? "original cost" : "nil"}`);
    }
    const reset = fmv ?? ZERO_D;
    const cost = original && original.gt(reset) ? original : reset;
    lots.add(key, { qty: dec(b.qty), cost, acquiredAt: RESET_PRICE_TIME, origin: `opening (${b.source})`, opening: { resetCost: reset, originalCost: original } });
    line.costUsd = full(cost);
    line.notes.push(`reset value $${full(reset)}; original ${original ? `$${full(original)}` : "not provided"}; cost base = ${original && original.gt(reset) ? "original" : "reset"}`);
    if (line.nafemRate) line.ngnValue = full(cost.mul(dec(line.nafemRate)));
    line.includedInTotals = false;
    lines.push(line);
    openingLots.push({ assetKey: key, asset: symbols.get(key)!, qty: b.qty, costUsd: full(cost), acquiredAt: RESET_PRICE_TIME, origin: b.source, resetCostUsd: full(reset), originalCostUsd: original ? full(original) : null });
    used.add("D11");
  }

  // ---- swap pairings (D1) ----
  const pairings = new Map<string, { disposed: ClassifiedTx[]; acquired: ClassifiedTx[] }>();
  for (const r of input.records) {
    if (!r.pairingId || !r.success) continue;
    const p = pairings.get(r.pairingId) ?? { disposed: [], acquired: [] };
    (r.label === "disposal_swap" ? p.disposed : p.acquired).push(r);
    pairings.set(r.pairingId, p);
  }
  const fmvOfLegs = async (legs: ClassifiedTx[]): Promise<Dec | null> => {
    let total = ZERO_D;
    for (const l of legs) {
      const pr = await priceOf(l.asset, l.timestamp);
      if (pr.status !== "ok") return null;
      total = total.plus(dec(l.amount).mul(dec(pr.quote.usd)));
    }
    return total;
  };

  // ---- records in time order ----
  const ordered = [...input.records].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.id < b.id ? -1 : 1));

  for (const r of ordered) {
    // Gas fee first: paid when the transaction is submitted (D2). Fees are paid even if the tx fails.
    if (r.fee) {
      used.add("D2");
      const nearAsset: Asset = { symbol: "NEAR", contract: null, decimals: 24 };
      const line = baseLine(r, { ts: r.timestamp, label: "gas_fee", kind: "gas_fee", asset: nearAsset, qty: r.fee.amount, circularRef: GAS_FEE_REF, method: "rule" });
      const fmv = await withPrice(line, nearAsset, r.timestamp, r);
      const rate = withFx(line);
      settleDisposal(line, "NEAR", dec(r.fee.amount), fmv, rate, r);
      if (fmv === null) line.includedInTotals = false;
      lines.push(line);
    }

    if (!r.success) continue;
    const label = r.label;
    const key = keyOf(r.asset);
    const qty = dec(r.amount);
    const ref = LABELS[label].circularRef;

    if (TECHNICAL.has(label)) {
      skippedTechnical[label] = (skippedTechnical[label] ?? 0) + 1;
      continue;
    }
    if (r.needsQuestion || label === "unknown") {
      const line = baseLine(r, { ts: r.timestamp, label, kind: "excluded", asset: r.asset, qty: r.amount, circularRef: ref, method: r.method });
      line.includedInTotals = false;
      line.notes.push("unresolved: excluded from totals");
      lines.push(line);
      warn("unresolved", `${r.direction} ${r.amount} ${r.asset.symbol} ${r.direction === "in" ? "from" : "to"} ${r.counterparty ?? "?"} on ${dateOf(r.timestamp)} is unresolved (${label}); excluded from totals`, r);
      continue;
    }
    if (qty.lte(0)) continue;
    if (r.method === "user") used.add("D14");

    // ---- income ----
    if (INCOME.has(label)) {
      if (label === "income_staking_reward") used.add("D3");
      const line = baseLine(r, { ts: r.timestamp, label, kind: "income", asset: r.asset, qty: r.amount, circularRef: ref, method: r.method });
      const fmv = await withPrice(line, r.asset, r.timestamp, r);
      const rate = withFx(line);
      if (fmv === null || rate === null) {
        line.includedInTotals = false;
        lots.add(key, { qty, cost: ZERO_D, acquiredAt: r.timestamp, origin: `${label} (no verifiable price: nil cost)` });
      } else {
        line.incomeUsd = full(fmv);
        line.incomeNgn = full(fmv.mul(rate));
        line.ngnValue = line.incomeNgn;
        line.costUsd = full(fmv);
        lots.add(key, { qty, cost: fmv, acquiredAt: r.timestamp, origin: label });
        line.notes.push("cost base = FMV at receipt (9.3.3(1), 9.5(4))");
      }
      lines.push(line);
      continue;
    }

    switch (label) {
      case "airdrop_no_value": {
        lots.add(key, { qty, cost: ZERO_D, acquiredAt: r.timestamp, origin: "airdrop_no_value" });
        const line = baseLine(r, { ts: r.timestamp, label, kind: "acquisition", asset: r.asset, qty: r.amount, circularRef: ref, method: r.method });
        line.costUsd = "0";
        line.notes.push("no ascertainable value: not income, nil cost base (9.6(4)-(6))");
        line.includedInTotals = false;
        lines.push(line);
        break;
      }

      case "acquisition_fiat": {
        const line = baseLine(r, { ts: r.timestamp, label, kind: "acquisition", asset: r.asset, qty: r.amount, circularRef: ref, method: r.method });
        const rate = withFx(line);
        const ngn = r.userFiat?.ngn;
        if (!ngn || rate === null) {
          line.includedInTotals = false;
          lots.add(key, { qty, cost: ZERO_D, acquiredAt: r.timestamp, origin: "acquisition_fiat (no naira amount / rate: nil cost)" });
          warn("missing_fiat_amount", `P2P purchase of ${r.amount} ${r.asset.symbol} on ${line.date} has no naira amount or rate; nil cost used`, r);
        } else {
          const cost = dec(ngn).div(rate);
          line.costUsd = full(cost);
          line.ngnValue = ngn;
          line.notes.push(`cost = NGN ${ngn} / NFEM ${line.nafemRate} (9.3.1)`);
          lots.add(key, { qty, cost, acquiredAt: r.timestamp, origin: "acquisition_fiat" });
        }
        lines.push(line);
        break;
      }

      case "acquisition_swap": {
        used.add("D1");
        const line = baseLine(r, { ts: r.timestamp, label, kind: "acquisition", asset: r.asset, qty: r.amount, circularRef: ref, method: r.method });
        const fmvReceived = await withPrice(line, r.asset, r.timestamp, null);
        const rate = withFx(line);
        let cost: Dec | null = null;
        const pair = r.pairingId ? pairings.get(r.pairingId) : undefined;
        if (pair && !r.incompleteSourceLeg) {
          const given = await fmvOfLegs(pair.disposed);
          if (given !== null) {
            // Split the FMV given up across acquired legs by their received FMV (or equally if unpriced).
            const receivedFmvs = await Promise.all(pair.acquired.map((a) => fmvOfLegs([a])));
            const totalReceived = receivedFmvs.every((x) => x !== null) ? receivedFmvs.reduce((s, x) => s.plus(x!), ZERO_D) : null;
            const mine = fmvReceived;
            cost = totalReceived && mine && totalReceived.gt(0) ? given.mul(mine).div(totalReceived) : given.div(pair.acquired.length);
            line.notes.push(`cost = dollar FMV of asset given up $${full(given)} (9.3.2, D1)`);
          }
        }
        if (cost === null) {
          if (fmvReceived !== null) {
            cost = fmvReceived;
            if (r.incompleteSourceLeg) {
              line.notes.push("incomplete source leg: cost = dollar FMV of asset received (9.1.2 Step 1(b)) pending source data");
              warn("incomplete_source_leg", `${r.amount} ${r.asset.symbol} acquired via NEAR Intents on ${line.date}: source leg not captured; cost = FMV received (9.1.2 Step 1(b))`, r);
            } else {
              line.notes.push("asset given up could not be valued; cost = FMV of asset received");
              warn("swap_cost_fallback", `Swap acquisition of ${r.asset.symbol} on ${line.date}: given-up leg unpriced; cost = FMV received`, r);
            }
          } else {
            cost = ZERO_D;
            line.includedInTotals = false;
            warn("no_verifiable_price", `Swap acquisition of ${r.amount} ${r.asset.symbol} on ${line.date}: no verifiable price for either leg; nil cost`, r);
          }
        }
        line.costUsd = full(cost);
        if (rate) line.ngnValue = full(cost.mul(rate));
        if (fmvReceived !== null) line.fmvReceivedUsd = full(fmvReceived);
        lots.add(key, { qty, cost, acquiredAt: r.timestamp, origin: "acquisition_swap" });
        line.includedInTotals = false; // acquisitions carry no tax themselves
        lines.push(line);
        break;
      }

      case "disposal_swap":
      case "disposal_payment":
      case "disposal_liquidation":
      case "disposal_sale_fiat": {
        const line = baseLine(r, { ts: r.timestamp, label, kind: "disposal", asset: r.asset, qty: r.amount, circularRef: ref, method: r.method });
        const fmv = await withPrice(line, r.asset, r.timestamp, label === "disposal_sale_fiat" ? null : r);
        const rate = withFx(line);
        let proceeds: Dec | null = fmv;
        if (label === "disposal_sale_fiat") {
          const ngn = r.userFiat?.ngn;
          if (!ngn || rate === null) {
            proceeds = null;
            warn("missing_fiat_amount", `P2P sale of ${r.amount} ${r.asset.symbol} on ${line.date} has no naira amount or rate; excluded`, r);
          } else {
            proceeds = dec(ngn).div(rate);
            line.notes.push(`proceeds = NGN ${ngn} / NFEM ${line.nafemRate} (9.1.2 Step 2(a))`);
          }
        }
        if (label === "disposal_swap") {
          used.add("D1");
          const pair = r.pairingId ? pairings.get(r.pairingId) : undefined;
          if (pair) {
            const received = await fmvOfLegs(pair.acquired);
            if (received !== null) {
              const given = await fmvOfLegs(pair.disposed);
              line.fmvReceivedUsd = full(given && fmv && given.gt(0) ? received.mul(fmv).div(given) : received.div(pair.disposed.length));
            }
          }
          line.notes.push("proceeds = dollar FMV of asset given up (9.3.2, D1); 9.1.2 Step 2(b) words it as value received (flagged, D1)");
        }
        settleDisposal(line, key, qty, proceeds, rate, r);
        lines.push(line);
        break;
      }

      case "gift_given":
      case "own_wallet_transfer":
      case "loan_repayment":
      case "defi_receipt":
      case "gift_received":
      case "loan_received": {
        const outgoing = r.direction === "out";
        if (outgoing) {
          const kind: LineKind = label === "gift_given" ? "gift_out" : label === "own_wallet_transfer" ? "transfer_out" : label === "loan_repayment" ? "loan" : "receipt_token";
          const line = baseLine(r, { ts: r.timestamp, label, kind, asset: r.asset, qty: r.amount, circularRef: ref, method: r.method });
          await withPrice(line, r.asset, r.timestamp, null);
          withFx(line);
          const c = lots.consume(key, qty);
          line.costUsd = full(c.cost);
          line.includedInTotals = false;
          if (c.shortfall.gt(0)) warn("missing_acquisition_history", `${r.asset.symbol}: ${label} of ${r.amount} on ${line.date} exceeds lots by ${full(c.shortfall)}`, r);
          if (label === "gift_given") {
            used.add("D9");
            line.notes.push("gift given: lots removed, no tax on donor (7.1 event 15, D9)");
          } else if (label === "own_wallet_transfer") {
            line.notes.push("own wallet: lots removed without disposal; cost carried to the other own wallet");
          } else if (label === "loan_repayment") {
            used.add("D13");
            const borrowed = loanAssetsByCounterparty.get(r.counterparty ?? "");
            if (!borrowed || !borrowed.has(key)) {
              warn("loan_repayment_asset_differs", `Loan repayment of ${r.amount} ${r.asset.symbol} to ${r.counterparty ?? "?"} on ${line.date}: ${borrowed ? "differs from the asset received" : "no loan received from this counterparty in the data"} (D13); may be a disposal`, r);
              line.notes.push("D13: repaid asset differs from (or no record of) the asset received");
            }
          } else {
            used.add("D4");
            receiptCarry.set(r.txHash, (receiptCarry.get(r.txHash) ?? ZERO_D).plus(c.cost));
            line.notes.push("deposit for receipt token: cost carried to the receipt (10.2, D4)");
          }
          lines.push(line);
        } else {
          const kind: LineKind = label === "gift_received" ? "gift_in" : label === "own_wallet_transfer" ? "transfer_in" : label === "loan_received" ? "loan" : "receipt_token";
          const line = baseLine(r, { ts: r.timestamp, label, kind, asset: r.asset, qty: r.amount, circularRef: ref, method: r.method });
          const fmv = await withPrice(line, r.asset, r.timestamp, label === "defi_receipt" ? null : r);
          const rate = withFx(line);
          let cost: Dec;
          if (label === "defi_receipt") {
            used.add("D4");
            const carried = receiptCarry.get(r.txHash);
            if (carried === undefined) {
              cost = ZERO_D;
              warn("receipt_cost_unmatched", `Receipt token ${r.amount} ${r.asset.symbol} on ${line.date} has no matching deposit in the same transaction; nil cost`, r);
            } else {
              cost = carried;
              receiptCarry.delete(r.txHash);
              line.notes.push("cost carried from the deposited asset (10.2, D4)");
            }
          } else {
            cost = fmv ?? ZERO_D;
            if (label === "gift_received") {
              used.add("D9");
              line.notes.push("gift received: cost base = market value at receipt (NTA s.36(1), D9)");
            } else if (label === "own_wallet_transfer") {
              warn("own_wallet_cost_not_tracked", `${r.amount} ${r.asset.symbol} from own wallet ${r.counterparty ?? "?"} on ${line.date}: cost from other own wallet not tracked; FMV at receipt used`, r);
              line.notes.push("cost from other own wallet not tracked; FMV at receipt used");
            } else {
              used.add("D13");
              const set = loanAssetsByCounterparty.get(r.counterparty ?? "") ?? new Set<string>();
              set.add(key);
              loanAssetsByCounterparty.set(r.counterparty ?? "", set);
              line.notes.push("loan received: liability, not income; cost base = FMV at receipt");
            }
          }
          line.costUsd = full(cost);
          if (rate) line.ngnValue = full(cost.mul(rate));
          line.includedInTotals = false;
          lots.add(key, { qty, cost, acquiredAt: r.timestamp, origin: label });
          lines.push(line);
        }
        break;
      }

      default: {
        const line = baseLine(r, { ts: r.timestamp, label, kind: "excluded", asset: r.asset, qty: r.amount, circularRef: ref, method: r.method });
        line.includedInTotals = false;
        line.notes.push(`label ${label} has no computation rule; excluded`);
        warn("unhandled_label", `Label ${label} on ${line.date} has no computation rule; excluded`, r);
        lines.push(line);
      }
    }
  }
  for (const [txHash] of receiptCarry) warnings.push({ code: "receipt_cost_unmatched", message: `Deposit for a receipt token in tx ${txHash} has no receipt leg; carried cost dropped`, txHash });

  // ---- year-end (9.4) ----
  used.add("D6");
  const inc = lines.filter((l) => l.kind === "income" && l.includedInTotals);
  const disp = lines.filter((l) => (l.kind === "disposal" || l.kind === "gas_fee") && l.includedInTotals && l.gainNgn !== undefined);
  const totalVaIncomeUsd = inc.reduce((s, l) => s.plus(dec(l.incomeUsd!)), ZERO_D);
  const totalVaIncomeNgn = inc.reduce((s, l) => s.plus(dec(l.incomeNgn!)), ZERO_D);
  const gains = disp.map((l) => dec(l.gainNgn!));
  const disposalGainsNgn = gains.filter((g) => g.gt(0)).reduce((s, g) => s.plus(g), ZERO_D);
  const disposalLossesNgn = gains.filter((g) => g.lt(0)).reduce((s, g) => s.plus(g.neg()), ZERO_D);
  const netGainsNgn = disposalGainsNgn.minus(disposalLossesNgn);
  const fees = lines.filter((l) => l.kind === "gas_fee" && l.includedInTotals);
  const gasFeesUsd = fees.reduce((s, l) => s.plus(dec(l.proceedsUsd ?? "0")), ZERO_D);
  const gasFeesNgn = fees.reduce((s, l) => s.plus(dec(l.ngnValue ?? "0")), ZERO_D);
  const carryForward = netGainsNgn.lt(0) ? netGainsNgn.neg() : ZERO_D;
  const chargeable = totalVaIncomeNgn.plus(Dec.max(netGainsNgn, ZERO_D));

  const notes: string[] = [];
  const other = input.otherIncomeNgn ? dec(input.otherIncomeNgn) : null;
  let pitWith: Dec;
  let pitWithout: Dec;
  let bands: PitBandUse[];
  if (other) {
    const w = pit(other.plus(chargeable));
    pitWith = w.tax;
    pitWithout = pit(other).tax;
    bands = w.bands;
    notes.push("tax attributable to VA = PIT(other income + chargeable VA) - PIT(other income) (D6 marginal)");
  } else {
    const w = pit(chargeable);
    pitWith = w.tax;
    pitWithout = ZERO_D;
    bands = w.bands;
    notes.push("assumes no other income");
  }
  notes.push("No withholding tax credits are visible on-chain; any WHT deducted at source is not credited here.");
  if (carryForward.gt(0)) notes.push("Net disposal loss is carried forward and not offset against income (9.4).");
  const fallbacks = lines.filter((l) => l.rateFallback).length;
  if (fallbacks) warnings.push({ code: "rate_fallback", message: `${fallbacks} line(s) used the most recent prior published NFEM rate (no rate on that date)` });

  return {
    year: input.year,
    lines,
    totals: {
      totalVaIncomeUsd: full(totalVaIncomeUsd),
      totalVaIncomeNgn: full(totalVaIncomeNgn),
      disposalGainsNgn: full(disposalGainsNgn),
      disposalLossesNgn: full(disposalLossesNgn),
      netGainsNgn: full(netGainsNgn),
      gasFeesUsd: full(gasFeesUsd),
      gasFeesNgn: full(gasFeesNgn),
      chargeableVaNgn: full(chargeable),
      linesIncluded: lines.filter((l) => l.includedInTotals).length,
      linesExcluded: lines.filter((l) => !l.includedInTotals).length,
    },
    carryForwardLossNgn: full(carryForward),
    tax: {
      otherIncomeNgn: other ? full(other) : null,
      basis: other ? "marginal_over_other_income" : "standalone",
      pitWithVaNgn: full(pitWith),
      pitWithoutVaNgn: full(pitWithout),
      taxAttributableToVaNgn: full(pitWith.minus(pitWithout)),
      bands,
      notes,
    },
    warnings,
    decisionsApplied: [...used].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((id) => ({ id, text: DECISIONS[id] })),
    openingLots,
    closingLots: lots.view(symbols),
    skippedTechnical,
  };
}
