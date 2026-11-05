/**
 * Plain-English presentation of report lines (Result page, line drawer). Pure and browser-safe;
 * every value comes from the line itself or its paired line. The treatment sentences restate the
 * label treatments in labels.ts in plain terms.
 */
import { LABELS, type LabelId } from "../tax/ng/labels";
import type { LineKind, ReportLine } from "../tax/ng/engine";
import { Dec, dec } from "../money";
import { fmtDate, fmtNgn } from "./format";

type LineLabel = LabelId | "gas_fee" | "opening_position";

const SHORT: Record<LineLabel, string> = {
  income_professional_fees: "Fees",
  income_employment: "Salary",
  income_business: "Business income",
  income_staking_reward: "Staking reward",
  income_defi_yield: "DeFi reward",
  income_airdrop: "Airdrop",
  airdrop_no_value: "Airdrop (no value)",
  disposal_swap: "Swap",
  acquisition_swap: "Swap",
  disposal_payment: "Payment",
  disposal_sale_fiat: "Sale for naira",
  disposal_liquidation: "Liquidation",
  acquisition_fiat: "Purchase",
  own_wallet_transfer: "Self transfer",
  staking_lockup: "Staking",
  wrap_unwrap: "Wrap",
  defi_receipt: "Liquid staking",
  loan_collateralised: "Loan",
  loan_received: "Loan received",
  loan_repayment: "Loan repayment",
  gift_given: "Gift given",
  gift_received: "Gift received",
  gas_refund: "Gas refund",
  round_trip: "Round trip",
  dust_no_value: "Dust",
  storage_deposit: "Storage deposit",
  unknown: "Unresolved",
  gas_fee: "Gas",
  opening_position: "Opening balance",
};

/** Plain restatement of the labels.ts treatment, one sentence or two. */
const PLAIN: Record<LineLabel, string> = {
  income_professional_fees: "Crypto received as fees for your work is income, valued at the market price on the day you received it. That value becomes its cost.",
  income_employment: "Salary paid in crypto is employment income, valued at the market price on the day you received it. That value becomes its cost.",
  income_business: "Crypto received in the course of your business is business income, valued at the market price on the day. That value becomes its cost.",
  income_staking_reward: "Staking rewards are income when received, valued at the market price on the day. That value becomes their cost.",
  income_defi_yield: "DeFi rewards are income when received, valued at the market price on the day. That value becomes their cost.",
  income_airdrop: "An airdrop with a market value is income when received, valued on the day. That value becomes its cost.",
  airdrop_no_value: "An airdrop with no ascertainable value is not income. It is held at a nil cost.",
  disposal_swap: "A swap disposes of the token you gave up at its dollar market value. The gain over what it cost you is taxable, and the token you received takes that value as its cost.",
  acquisition_swap: "The token you received in a swap is not taxed itself. Its cost is the dollar value of what you gave up.",
  disposal_payment: "Paying with crypto is a disposal at market value. The gain over what it cost you is taxable.",
  disposal_sale_fiat: "Selling crypto for naira is a disposal. The naira you received, converted at the CBN rate, are the proceeds; the gain over cost is taxable.",
  disposal_liquidation: "A liquidation disposes of the collateral at market value. The gain over what it cost you is taxable.",
  acquisition_fiat: "Buying crypto with naira is not taxable. The naira you paid, converted at the CBN rate, become its cost.",
  own_wallet_transfer: "Moving crypto between accounts you own is not a disposal, so no tax arises.",
  staking_lockup: "Locking NEAR with a validator is not a disposal; you still own it.",
  wrap_unwrap: "Wrapping NEAR into wNEAR (or back) is not a disposal; both are the same asset.",
  defi_receipt: "Depositing into liquid staking gives you a receipt token. It is not a disposal; your cost carries over to the receipt token.",
  loan_collateralised: "Locking crypto as loan collateral is not a disposal.",
  loan_received: "A loan you must repay is not income.",
  loan_repayment: "Repaying a loan in the asset you borrowed is not a disposal.",
  gift_given: "Giving crypto away is not taxed on you here; it leaves your holdings at its cost.",
  gift_received: "A gift is not income to you. Its market value when received becomes its cost.",
  gas_refund: "A refund of unused network fees is not income.",
  round_trip: "Funds that went out and came straight back in the same transaction are not a disposal.",
  dust_no_value: "Tiny transfers with no meaningful value are left out as immaterial.",
  storage_deposit: "A refundable storage deposit is not a disposal.",
  unknown: "Uwii could not tell what this was, so it is left out of the totals until you answer its question.",
  gas_fee: "Network fees are paid in NEAR, so each one is a small disposal of NEAR. They are listed separately and are not deductible.",
  opening_position: "Your holding at the start of 2026. Its cost is the higher of what you paid and its value on 31 Dec 2025 (decision D11).",
};

const isLineLabel = (l: string): l is LineLabel => l in SHORT;

export function shortLabel(label: string): string {
  return isLineLabel(label) ? SHORT[label] : label.replace(/_/g, " ");
}

export function plainExplanation(line: Pick<ReportLine, "label" | "kind">): string {
  if (line.kind === "excluded") return PLAIN.unknown;
  return isLineLabel(line.label) ? PLAIN[line.label] : "This line has no plain-English explanation yet; see the circular reference.";
}

/** labels.ts treatment text (technical), for the drawer's detail. */
export function treatment(label: string): string | null {
  return label in LABELS ? LABELS[label as LabelId].treatment : null;
}

// ---------- filters ----------

export type LineCategory = "Income" | "Purchase" | "Disposal" | "Swap" | "Self transfer" | "Gift" | "Loan" | "Gas" | "Opening" | "Unresolved" | "Other";

export function lineCategory(line: Pick<ReportLine, "label" | "kind">): LineCategory {
  if (line.kind === "excluded") return "Unresolved";
  switch (line.kind) {
    case "income":
      return "Income";
    case "gas_fee":
      return "Gas";
    case "opening":
      return "Opening";
    case "gift_in":
    case "gift_out":
      return "Gift";
    case "loan":
      return "Loan";
    case "transfer_in":
    case "transfer_out":
    case "receipt_token":
      return "Self transfer";
  }
  if (line.label === "disposal_swap" || line.label === "acquisition_swap") return "Swap";
  if (line.kind === "acquisition") return line.label === "acquisition_fiat" ? "Purchase" : "Other";
  if (line.kind === "disposal") return "Disposal";
  return "Other";
}

export type MethodFilter = "rule" | "ai" | "user" | "needs";

/** Who labelled the line; unresolved lines "need you". Opening balances are computed, shown as rule. */
export function lineMethod(line: Pick<ReportLine, "method" | "kind">): MethodFilter {
  if (line.kind === "excluded") return "needs";
  if (line.method === "ai") return "ai";
  if (line.method === "user") return "user";
  return "rule";
}

// ---------- quantities, signs, titles ----------

const OUT: LineKind[] = ["disposal", "gas_fee", "gift_out", "transfer_out"];
const IN: LineKind[] = ["income", "acquisition", "gift_in", "transfer_in"];

/** "+" received, "−" given up, "" when the line alone does not say. */
export function lineSign(line: Pick<ReportLine, "kind" | "label">): "+" | "−" | "" {
  if (OUT.includes(line.kind) || line.label === "loan_repayment") return "−";
  if (IN.includes(line.kind) || line.label === "loan_received") return "+";
  if (line.kind === "excluded") return line.label.startsWith("disposal") || line.label === "gift_given" ? "−" : "";
  return "";
}

/** Short quantity: 2 dp with separators from 1 up (whole numbers without ".00" unless trimWhole is false), 4 significant digits below 1. */
export function fmtQtyShort(qty: string, trimWhole = true): string {
  const d = dec(qty).abs();
  if (d.isZero()) return "0";
  if (d.lt(1)) return d.toSignificantDigits(4, Dec.ROUND_HALF_UP).toFixed();
  const two = fmtNgn(d.toFixed());
  return trimWhole ? two.replace(/\.00$/, "") : two;
}

const longDate = (iso: string) => fmtDate(iso).replace(/^0/, "");

/** The other leg of a swap: same tx for rule-paired swaps; same record for a user-provided Intents source leg. */
export function swapCounterpart(line: ReportLine, lines: ReportLine[]): ReportLine | null {
  if (line.label !== "disposal_swap" && line.label !== "acquisition_swap") return null;
  const want = line.label === "disposal_swap" ? "acquisition_swap" : "disposal_swap";
  if (line.method === "user" && line.recordId) {
    const byRecord = lines.find((l) => l !== line && l.label === want && l.recordId === line.recordId);
    if (byRecord) return byRecord;
  }
  return lines.find((l) => l !== line && l.label === want && l.txHash !== "" && l.txHash === line.txHash) ?? null;
}

/** Plain-English drawer title built from the line (and its swap counterpart). */
export function lineTitle(line: ReportLine, lines: ReportLine[]): string {
  const q = `${fmtQtyShort(line.qty)} ${line.asset}`;
  const on = `on ${longDate(line.timestamp)}`;
  if (line.kind === "excluded") return `Unresolved: ${q} ${on}`;
  switch (line.label) {
    case "disposal_swap":
    case "acquisition_swap": {
      const other = swapCounterpart(line, lines);
      const [give, get] = line.label === "disposal_swap" ? [line, other] : [other, line];
      if (give && get) return `Swap: ${fmtQtyShort(give.qty)} ${give.asset} for ${fmtQtyShort(get.qty)} ${get.asset} ${on}`;
      return line.label === "acquisition_swap" ? `Swap: received ${q} ${on}` : `Swap: gave up ${q} ${on}`;
    }
    case "acquisition_fiat":
      return `Purchase: ${q} bought with naira ${on}`;
    case "disposal_sale_fiat":
      return `Sale: ${q} sold for naira ${on}`;
    case "disposal_payment":
      return `Payment: ${q} spent ${on}`;
    case "gas_fee":
      return `Gas fee: ${q} ${on}`;
    case "opening_position":
      return `Opening balance: ${q} at the start of 2026`;
    default:
      return `${shortLabel(line.label)}: ${q} ${on}`;
  }
}

/** Short asset text for the table: "wNEAR → RHEA" for swaps when the counterpart is known. */
export function lineAssetText(line: ReportLine, lines: ReportLine[]): string {
  const other = swapCounterpart(line, lines);
  if (!other) return line.asset;
  return line.label === "disposal_swap" ? `${line.asset} → ${other.asset}` : `${other.asset} → ${line.asset}`;
}

