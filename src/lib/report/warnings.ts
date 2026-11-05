/**
 * Plain-English warnings for the Result page. Engine warnings are grouped (by code and asset) into one
 * sentence each, filled only with values from the report; the technical messages stay on the lines
 * (shown in the line drawer). Pure and browser-safe.
 */
import type { ReportLine, Warning } from "../tax/ng/engine";
import { Dec, dec } from "../money";
import { fmtDate, fmtNgn } from "./format";
import { fmtQtyShort, shortLabel } from "./explain";

export interface PlainWarning {
  code: string;
  text: string;
  /** Records the warning is about (first one opens in the drawer). */
  recordIds: string[];
}

export interface WarningInput {
  warnings: Warning[];
  lines: ReportLine[];
  tax: { basis: string; otherIncomeNgn: string | null };
  totals: { gasFeesNgn: string };
  carryForwardLossNgn: string;
}

const short = (iso: string) => fmtDate(iso).replace(/^0/, "");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "Staking reward" -> "staking reward", but "DeFi reward" stays. */
const lowerFirst = (s: string) => (/^[A-Z][a-z]+$/.test(s.split(" ")[0]) ? s[0].toLowerCase() + s.slice(1) : s);
const dayMonth = (iso: string) => short(iso).split(" ").slice(0, 2).join(" ");

/** "4 Oct 2026", "4–5 Oct 2026" or "4 Oct – 2 Nov 2026" from ISO dates. */
export function dateRange(dates: string[]): string {
  const s = [...new Set(dates.map((d) => d.slice(0, 10)))].sort();
  if (s.length === 0) return "";
  const [a, b] = [s[0], s[s.length - 1]];
  if (a === b) return short(a);
  const [da, db] = [short(a).split(" "), short(b).split(" ")];
  if (da[1] === db[1] && da[2] === db[2]) return `${da[0]}–${db[0]} ${db[1]} ${db[2]}`;
  return `${da[0]} ${da[1]} – ${short(b)}`;
}

const sumQty = (qtys: string[]) => qtys.reduce((s, q) => s.plus(dec(q)), new Dec(0)).toFixed();

/** Price sources that were tried ("CoinGecko: no listing…" | "Rhea/Ref v2: …" -> "CoinGecko, Rhea/Ref v2"). */
function sourcesTried(priceMethod: string | null): string {
  if (!priceMethod) return "";
  const names = priceMethod.split(" | ").map((p) => p.split(":")[0].trim()).filter(Boolean);
  return [...new Set(names)].join(", ");
}

const SHORTFALL_RE = /^missing acquisition history for ([0-9.]+) /;

export function plainWarnings(input: WarningInput): PlainWarning[] {
  const out: PlainWarning[] = [];
  const lineByRecord = new Map<string, ReportLine[]>();
  for (const l of input.lines) if (l.recordId) lineByRecord.set(l.recordId, [...(lineByRecord.get(l.recordId) ?? []), l]);
  const byCode = new Map<string, Warning[]>();
  for (const w of input.warnings) byCode.set(w.code, [...(byCode.get(w.code) ?? []), w]);
  const ids = (ws: Warning[]) => [...new Set(ws.map((w) => w.recordId).filter((x): x is string => Boolean(x)))];

  // Unresolved first: it decides whether the report is a draft.
  const unresolved = byCode.get("unresolved") ?? [];
  if (unresolved.length) {
    out.push({
      code: "unresolved",
      text: `${plural(unresolved.length, "transaction")} still ${unresolved.length === 1 ? "needs" : "need"} your answer, so ${unresolved.length === 1 ? "it is" : "they are"} left out of the totals. Answer the open questions to include ${unresolved.length === 1 ? "it" : "them"}.`,
      recordIds: ids(unresolved),
    });
  }

  // Missing acquisition history, one sentence per asset, with the total quantity given a nil cost.
  const missingLines = input.lines.filter((l) => l.notes.some((n) => SHORTFALL_RE.test(n)));
  const missingByAsset = new Map<string, ReportLine[]>();
  for (const l of missingLines) missingByAsset.set(l.asset, [...(missingByAsset.get(l.asset) ?? []), l]);
  for (const [asset, ls] of missingByAsset) {
    const total = sumQty(ls.map((l) => SHORTFALL_RE.exec(l.notes.find((n) => SHORTFALL_RE.test(n))!)![1]));
    out.push({
      code: "missing_acquisition_history",
      text:
        `${plural(ls.length, `${asset} disposal`)} (${dateRange(ls.map((l) => l.timestamp))}) used more ${asset} than Uwii saw you acquire. ` +
        `The missing ${fmtQtyShort(total)} ${asset} was given a nil cost, which overstates the gain. Answer the open questions or add your other wallets.`,
      recordIds: [...new Set(ls.map((l) => l.recordId).filter((x): x is string => Boolean(x)))],
    });
  }

  for (const w of byCode.get("incomplete_source_leg") ?? []) {
    const l = w.recordId ? lineByRecord.get(w.recordId)?.find((x) => x.label === "acquisition_swap") : undefined;
    out.push({
      code: "incomplete_source_leg",
      text: l
        ? `${fmtQtyShort(l.qty)} ${l.asset} received through NEAR Intents on ${short(l.timestamp)} is treated as a swap, but what you gave up is not recorded, so its cost uses the value received (Circular 9.1.2 Step 1(b)). Add it on the Questions page to finalise.`
        : "A swap through NEAR Intents has no record of what you gave up, so its cost uses the value received (Circular 9.1.2 Step 1(b)).",
      recordIds: ids([w]),
    });
  }

  // No verifiable price, one sentence per asset and line type.
  const noPrice = input.lines.filter((l) => l.priceStatus === "no_verifiable_price" && l.recordId && (byCode.get("no_verifiable_price") ?? []).some((w) => w.recordId === l.recordId));
  const noPriceGroups = new Map<string, ReportLine[]>();
  for (const l of noPrice) noPriceGroups.set(`${l.asset}|${l.label}`, [...(noPriceGroups.get(`${l.asset}|${l.label}`) ?? []), l]);
  for (const ls of noPriceGroups.values()) {
    const l = ls[0];
    const what = `${l.asset} ${lowerFirst(shortLabel(l.label))}`;
    const tried = sourcesTried(l.priceMethod);
    out.push({
      code: "no_verifiable_price",
      text: `${plural(ls.length, what, `${what}s`)} (${dateRange(ls.map((x) => x.timestamp))}) ${ls.length === 1 ? "has" : "have"} no verifiable price, so ${ls.length === 1 ? "it is" : "they are"} left out of the totals (Circular 9.2(4)).${tried ? ` Checked: ${tried}.` : ""}`,
      recordIds: ls.map((x) => x.recordId!),
    });
  }
  // A no-price warning without a priced line (e.g. a swap with neither leg priced).
  for (const w of (byCode.get("no_verifiable_price") ?? []).filter((w) => !noPrice.some((l) => l.recordId === w.recordId))) {
    const l = w.recordId ? lineByRecord.get(w.recordId)?.[0] : undefined;
    out.push({
      code: "no_verifiable_price",
      text: l ? `${fmtQtyShort(l.qty)} ${l.asset} on ${short(l.timestamp)} has no verifiable price (Circular 9.2(4)), so a nil cost was used.` : "An asset has no verifiable price (Circular 9.2(4)).",
      recordIds: ids([w]),
    });
  }

  const fallbacks = input.lines.filter((l) => l.rateFallback && l.rateDate);
  if (fallbacks.length) {
    const pairs = [...new Map(fallbacks.map((l) => [l.date, l.rateDate!])).entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    out.push({
      code: "rate_fallback",
      text:
        `The CBN NFEM rate was not published on ${plural(pairs.length, "date")}, so ${plural(fallbacks.length, "line")} use the most recent earlier rate (decision D8): ` +
        `${pairs.map(([d, r]) => `${dayMonth(d)} used ${dayMonth(r)}`).join("; ")} ${pairs[pairs.length - 1][0].slice(0, 4)}.`,
      recordIds: [...new Set(fallbacks.map((l) => l.recordId).filter((x): x is string => Boolean(x)))],
    });
  }

  const one = (code: string, make: (l: ReportLine | undefined, w: Warning) => string) => {
    for (const w of byCode.get(code) ?? []) out.push({ code, text: make(w.recordId ? lineByRecord.get(w.recordId)?.find((x) => x.kind !== "gas_fee") : undefined, w), recordIds: ids([w]) });
  };
  one("missing_fiat_amount", (l) =>
    l ? `The naira amount for the P2P ${l.kind === "disposal" ? "sale" : "purchase"} of ${fmtQtyShort(l.qty)} ${l.asset} on ${short(l.timestamp)} is missing, so ${l.kind === "disposal" ? "the sale is left out of the totals" : "it has a nil cost"}.` : "A P2P naira amount is missing.",
  );
  one("swap_cost_fallback", (l) =>
    l ? `What you gave up for ${fmtQtyShort(l.qty)} ${l.asset} on ${short(l.timestamp)} could not be valued, so its cost uses the market value of what you received.` : "A swap's given-up asset could not be valued.",
  );
  one("loan_repayment_asset_differs", (l) =>
    l ? `The loan repayment of ${fmtQtyShort(l.qty)} ${l.asset} on ${short(l.timestamp)} is in a different asset from the loan, or no loan from that account was found. It may be a disposal (decision D13).` : "A loan repayment differs from the loan received (D13).",
  );
  one("own_wallet_cost_not_tracked", (l) =>
    l ? `${fmtQtyShort(l.qty)} ${l.asset} from your own wallet on ${short(l.timestamp)} has no tracked cost from that wallet, so its market value on receipt is used.` : "A transfer from your own wallet has no tracked cost.",
  );
  one("receipt_cost_unmatched", (l) =>
    l ? `The liquid-staking receipt of ${fmtQtyShort(l.qty)} ${l.asset} on ${short(l.timestamp)} has no matching deposit, so it has a nil cost.` : "A liquid-staking deposit and its receipt token could not be matched.",
  );
  one("unhandled_label", (l) => (l ? `${fmtQtyShort(l.qty)} ${l.asset} on ${short(l.timestamp)} has no computation rule and is left out of the totals.` : "A line has no computation rule."));
  one("no_fx_rate", () => "A CBN NFEM rate was not available for a date, so the affected line is left out of the totals.");
  one("ai_signature_unverified", (_l, w) => {
    const n = Number(/^(\d+) /.exec(w.message)?.[1] ?? 0);
    return `${n ? plural(n, "AI answer") : "Some AI answers"} ${n === 1 ? "has" : "have"} no verified response signature, so ${n === 1 ? "it was" : "they were"} turned into questions for you.`;
  });
  one("privacy_proof_unavailable", (_l, w) => `Part of the privacy proof is not available: ${w.message.replace(/^Privacy proof: /, "")}.`);

  // Treatments worth knowing even when nothing is wrong.
  if (dec(input.totals.gasFeesNgn).gt(0)) {
    const gas = input.lines.filter((l) => l.kind === "gas_fee");
    out.push({ code: "gas_not_deductible", text: `Gas fees of ₦${fmtNgn(input.totals.gasFeesNgn)} across ${plural(gas.length, "transaction")} are listed but do not reduce your gains; they are not deductible (decision D2).`, recordIds: [] });
  }
  if (input.lines.some((l) => l.kind === "opening")) {
    out.push({ code: "d11_reset", text: "Holdings from before 2026 use the higher of their original cost and their value on 31 Dec 2025 (decision D11). Each affected line also shows the gain without that reset.", recordIds: [] });
  }
  if (input.tax.basis === "standalone") {
    out.push({ code: "assumes_no_other_income", text: "Tax is worked out as if crypto were your only income in 2026. Add your other taxable income on the Questions page so the correct band applies.", recordIds: [] });
  }
  if (dec(input.carryForwardLossNgn).gt(0)) {
    out.push({ code: "loss_carried_forward", text: `A net disposal loss of ₦${fmtNgn(input.carryForwardLossNgn)} is carried forward. It does not reduce your income for 2026.`, recordIds: [] });
  }
  out.push({ code: "no_wht_credit", text: "Withholding tax deducted at source is not visible on-chain, so none is credited here.", recordIds: [] });
  return out;
}
