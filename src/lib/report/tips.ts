/**
 * "Ways to pay less, legally": deterministic tips generated only from the user's own report. Each tip
 * has a condition; a tip whose condition does not hold is never returned. No generic advice.
 * Amounts are exact decimal strings (no floating point). Shared by the Result page and the PDF.
 */
import type { ReportLine } from "../tax/ng/engine";
import type { TaxReliefs } from "../tax/ng/engine";
import { Dec, ZERO_D, dec, full } from "../money";
import { fmtQtyShort } from "./explain";
import { fmtNgn } from "./format";

export type TipId = "missing_cost" | "loss_carry_forward" | "rent_relief" | "add_income_and_reliefs" | "no_verifiable_price" | "gas_not_deductible";

export interface TaxTip {
  id: TipId;
  title: string;
  text: string;
  /** Amount at stake (NGN, full precision) where it can be computed from the report. */
  amountNgn: string | null;
  /** What the amount means ("up to", "carried forward", ...). */
  amountLabel: string | null;
  citation: string;
  /** Lines the tip is about (the first opens in the line drawer). */
  recordIds: string[];
}

export interface TipsInput {
  lines: ReportLine[];
  totals: { gasFeesNgn: string };
  carryForwardLossNgn: string;
  tax: { otherIncomeNgn: string | null; reliefs?: TaxReliefs };
}

const naira = (v: string) => `₦${fmtNgn(v)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const ids = (ls: ReportLine[]) => [...new Set(ls.map((l) => l.recordId).filter((x): x is string => Boolean(x)))];

/** Same note the engine writes when FIFO runs out of lots (engine.ts settleDisposal). */
const SHORTFALL_RE = /^missing acquisition history for ([0-9.]+) /;

/**
 * Gain on the nil-cost part of each included disposal: the share of proceeds for the units with no
 * acquisition history, converted at the line's NFEM rate. That part has a cost of nil, so its whole
 * value is gain; a recorded cost could lower the gain by at most this much.
 */
export function nilCostGainNgn(lines: ReportLine[]): { amountNgn: Dec; lines: ReportLine[]; qtyByAsset: Map<string, Dec> } {
  let amount: Dec = ZERO_D;
  const hit: ReportLine[] = [];
  const qtyByAsset = new Map<string, Dec>();
  for (const l of lines) {
    if (!l.includedInTotals || (l.kind !== "disposal" && l.kind !== "gas_fee")) continue;
    const note = l.notes.find((n) => SHORTFALL_RE.test(n));
    if (!note || !l.proceedsUsd || !l.nafemRate) continue;
    const shortfall = dec(SHORTFALL_RE.exec(note)![1]);
    const qty = dec(l.qty);
    if (qty.isZero()) continue;
    amount = amount.plus(shortfall.div(qty).mul(dec(l.proceedsUsd)).mul(dec(l.nafemRate)));
    hit.push(l);
    qtyByAsset.set(l.asset, (qtyByAsset.get(l.asset) ?? ZERO_D).plus(shortfall));
  }
  return { amountNgn: amount, lines: hit, qtyByAsset };
}

export function taxTips(r: TipsInput): TaxTip[] {
  const tips: TaxTip[] = [];
  const reliefInputs = r.tax.reliefs?.inputs ?? {};
  const hasOther = Boolean(r.tax.otherIncomeNgn);
  const hasReliefs = Boolean(r.tax.reliefs);

  // Disposals that used units with no acquisition history (nil cost).
  const nil = nilCostGainNgn(r.lines);
  if (nil.lines.length && nil.amountNgn.gt(0)) {
    const what = list([...nil.qtyByAsset].map(([a, q]) => `${fmtQtyShort(full(q))} ${a}`));
    tips.push({
      id: "missing_cost",
      title: "Add what you paid for the coins you sold",
      text:
        `${plural(nil.lines.length, "disposal")} used ${what} that Uwii didn't see you acquire, so ${nil.qtyByAsset.size === 1 && nil.lines.length === 1 ? "it was" : "they were"} given a nil cost. ` +
        `Add your other wallets or receipts; this may lower your gain by up to ${naira(full(nil.amountNgn))}.`,
      amountNgn: full(nil.amountNgn),
      amountLabel: "less gain, at most",
      citation: "Circular 9.1.2; 9.3.3",
      recordIds: ids(nil.lines),
    });
  }

  // Net disposal loss carried forward.
  if (dec(r.carryForwardLossNgn).gt(0)) {
    tips.push({
      id: "loss_carry_forward",
      title: "Your loss carries forward",
      text: `Your net loss of ${naira(r.carryForwardLossNgn)} carries forward to future crypto gains (9.4). Keep this worksheet so you can claim it.`,
      amountNgn: r.carryForwardLossNgn,
      amountLabel: "to carry forward",
      citation: "Circular 9.4",
      recordIds: [],
    });
  }

  // Rent relief: other income entered, rent not entered.
  if (hasOther && !reliefInputs.rentPaidNgn) {
    tips.push({
      id: "rent_relief",
      title: "Rent relief",
      text: "If you pay rent, rent relief can reduce your tax (up to ₦500,000 off your income). Enter your annual rent under Reliefs and deductions on the Questions page.",
      amountNgn: "500000",
      amountLabel: "off your income, at most",
      citation: "NTA 2025 s.30",
      recordIds: [],
    });
  }

  // Nothing entered about the rest of the year.
  if (!hasOther && !hasReliefs) {
    tips.push({
      id: "add_income_and_reliefs",
      title: "Add your other income and reliefs",
      text: "Add your other income and reliefs so the right band and reliefs apply. Without them, Uwii assumes your crypto is your only income and that you have no reliefs.",
      amountNgn: null,
      amountLabel: null,
      citation: "D6; NTA 2025 s.30",
      recordIds: [],
    });
  }

  // Lines left out for lack of a verifiable price.
  const noPrice = r.lines.filter((l) => !l.includedInTotals && l.priceStatus === "no_verifiable_price");
  if (noPrice.length) {
    const assets = [...new Set(noPrice.map((l) => l.asset))];
    tips.push({
      id: "no_verifiable_price",
      title: "Tokens without a verifiable price",
      text:
        `${plural(noPrice.length, "line")} in ${list(assets)} ${noPrice.length === 1 ? "has" : "have"} no verifiable price, so ${noPrice.length === 1 ? "it is" : "they are"} left out of your totals (Circular 9.2(4)). ` +
        "If the token did trade, keep evidence of its price at the time, such as an exchange or pool record of a trade on that date, so a tax consultant can value it correctly.",
      amountNgn: null,
      amountLabel: null,
      citation: "Circular 9.2(4)",
      recordIds: ids(noPrice),
    });
  }

  // Gas fees: say plainly that they are not deductible.
  const gas = r.lines.filter((l) => l.kind === "gas_fee" && l.includedInTotals);
  if (gas.length && dec(r.totals.gasFeesNgn).gt(0)) {
    tips.push({
      id: "gas_not_deductible",
      title: "Gas fees don't reduce your tax",
      text: `You paid ${naira(r.totals.gasFeesNgn)} in gas across ${plural(gas.length, "transaction")}. Gas fees are not deductible (D2), so they don't lower your gains; spending NEAR on gas is itself a small disposal.`,
      amountNgn: r.totals.gasFeesNgn,
      amountLabel: "not deductible",
      citation: "Circular 7.1 event 5; D2",
      recordIds: ids(gas),
    });
  }

  return tips;
}
