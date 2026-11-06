/**
 * Report lines grouped into sections, shared by the Result page, the PDF and the CSV exports.
 * Presentation only: every amount is a line value from the engine, summed at full precision.
 *
 * Sections (in order): taxable income; disposals and swaps (each swap as one row); gas fees; not
 * taxable; excluded. Subtotals reconcile with the report totals:
 *   income subtotal                    = totals.totalVaIncomeNgn
 *   disposals net gain + gas net gain  = totals.netGainsNgn   (gas spends NEAR: a small disposal, D2)
 *   gas NGN value                      = totals.gasFeesNgn
 */
import type { ReportLine } from "../tax/ng/engine";
import { Dec, dec, full } from "../money";

export type SectionId = "income" | "disposals" | "gas" | "not_taxable" | "excluded";

export const SECTION_ORDER: SectionId[] = ["income", "disposals", "gas", "not_taxable", "excluded"];

export const SECTION_META: Record<SectionId, { title: string; explanation: string; subtotalLabel: string | null }> = {
  income: {
    title: "Income (taxable)",
    explanation: "Crypto you received as income, valued in naira on the day you received it.",
    subtotalLabel: "Income",
  },
  disposals: {
    title: "Disposals and swaps",
    explanation: "Each disposal's gain or loss: what you got for it minus what it cost you, converted at the CBN NFEM rate. A swap is one row.",
    subtotalLabel: "Net gain",
  },
  gas: {
    title: "Gas fees (not deductible)",
    explanation: "Network fees paid in NEAR. Listed separately; they do not reduce your gains. The small gain or loss on the NEAR spent counts in net disposal gains.",
    subtotalLabel: "Gas fees",
  },
  not_taxable: {
    title: "Not taxable",
    explanation: "Movements that are not taxable events: purchases, transfers between your own accounts, gifts, loans, receipts and opening balances.",
    subtotalLabel: null,
  },
  excluded: {
    title: "Excluded",
    explanation: "Left out of the totals, with the reason for each.",
    subtotalLabel: null,
  },
};

export interface LineRow {
  type: "line";
  line: ReportLine;
  /** Why the line is excluded (excluded section only). */
  reason?: string;
}

export interface SwapRow {
  type: "swap";
  pairingId: string;
  /** Disposal legs (what was given up) and acquisition legs (what was received). */
  gives: ReportLine[];
  gets: ReportLine[];
  timestamp: string;
  proceedsUsd: string | null;
  costUsd: string | null;
  gainUsd: string | null;
  gainNgn: string | null;
  nafemRate: string | null;
  rateFallback: boolean;
  reason?: string;
}

export type SectionRow = LineRow | SwapRow;

export interface LineSection {
  id: SectionId;
  title: string;
  explanation: string;
  rows: SectionRow[];
  /** Report lines in the section (a swap row counts its legs). */
  lineCount: number;
  /** NGN subtotal at full precision (null for not-taxable and excluded). */
  subtotalNgn: string | null;
  subtotalLabel: string | null;
  /** Gas only: net gain/loss on the NEAR spent, part of totals.netGainsNgn. */
  gainNgn?: string;
}

const SWAP_LABELS = new Set(["disposal_swap", "acquisition_swap"]);

/** The swap pairing a line belongs to: both legs of a swap share the transaction hash (rule swaps and user-provided Intents source legs). */
export function pairingIdOf(line: ReportLine, lines: ReportLine[]): string | null {
  if (!SWAP_LABELS.has(line.label) || !line.txHash) return null;
  const other = line.label === "disposal_swap" ? "acquisition_swap" : "disposal_swap";
  return lines.some((l) => l !== line && l.label === other && l.txHash === line.txHash) ? `swap:${line.txHash}` : null;
}

const INCLUDED_KINDS = new Set(["income", "disposal", "gas_fee"]);

function excludedReason(l: ReportLine): string {
  if (l.kind === "excluded") return "Unresolved: answer its question to include it";
  if (l.priceStatus === "no_verifiable_price") return "No verifiable price (9.2(4))";
  if (!l.nafemRate) return "No CBN NFEM rate on or before this date";
  if (l.label === "disposal_sale_fiat" || l.label === "acquisition_fiat") return "Naira amount missing";
  return "Not included in the totals";
}

/** The section of a single line (used for the CSV "section" column). Swap acquisition legs follow their disposal leg. */
export function sectionOfLine(line: ReportLine, lines: ReportLine[]): SectionId {
  if (line.kind === "excluded") return "excluded";
  if (line.label === "acquisition_swap") {
    const pid = pairingIdOf(line, lines);
    if (!pid) return "not_taxable";
    const gives = lines.filter((l) => l.label === "disposal_swap" && l.txHash === line.txHash);
    return gives.every((g) => g.includedInTotals) ? "disposals" : "excluded";
  }
  if (INCLUDED_KINDS.has(line.kind)) {
    if (!line.includedInTotals) return "excluded";
    return line.kind === "income" ? "income" : line.kind === "gas_fee" ? "gas" : "disposals";
  }
  return "not_taxable";
}

const sumOf = (vals: (string | null | undefined)[]): Dec => vals.reduce<Dec>((s, v) => (v === null || v === undefined || v === "" ? s : s.plus(dec(v))), new Dec(0));
const sumOrNull = (vals: (string | null | undefined)[]) => (vals.every((v) => v === null || v === undefined || v === "") ? null : full(sumOf(vals)));

function swapRow(pairingId: string, legs: ReportLine[]): SwapRow {
  const gives = legs.filter((l) => l.label === "disposal_swap");
  const gets = legs.filter((l) => l.label === "acquisition_swap");
  const first = [...legs].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))[0];
  return {
    type: "swap",
    pairingId,
    gives,
    gets,
    timestamp: first.timestamp,
    proceedsUsd: sumOrNull(gives.map((g) => g.proceedsUsd)),
    costUsd: sumOrNull(gives.map((g) => g.costUsd)),
    gainUsd: sumOrNull(gives.map((g) => g.gainUsd)),
    gainNgn: sumOrNull(gives.map((g) => g.gainNgn)),
    nafemRate: gives[0]?.nafemRate ?? null,
    rateFallback: gives.some((g) => g.rateFallback),
  };
}

export const rowTimestamp = (r: SectionRow) => (r.type === "swap" ? r.timestamp : r.line.timestamp);
export const rowLines = (r: SectionRow): ReportLine[] => (r.type === "swap" ? [...r.gives, ...r.gets] : [r.line]);

/** Group the report's lines into the five sections, with subtotals. */
export function lineSections(report: { lines: ReportLine[] }): LineSection[] {
  const lines = report.lines;
  const rows: Record<SectionId, SectionRow[]> = { income: [], disposals: [], gas: [], not_taxable: [], excluded: [] };
  const seenPairs = new Set<string>();
  for (const l of lines) {
    const pid = pairingIdOf(l, lines);
    if (pid) {
      if (seenPairs.has(pid)) continue;
      seenPairs.add(pid);
      const row = swapRow(pid, lines.filter((x) => pairingIdOf(x, lines) === pid));
      const included = row.gives.every((g) => g.includedInTotals);
      if (included) rows.disposals.push(row);
      else rows.excluded.push({ ...row, reason: excludedReason(row.gives.find((g) => !g.includedInTotals)!) });
      continue;
    }
    const section = sectionOfLine(l, lines);
    rows[section].push(section === "excluded" ? { type: "line", line: l, reason: excludedReason(l) } : { type: "line", line: l });
  }

  const sectionLines = (id: SectionId) => rows[id].flatMap(rowLines);
  const out: LineSection[] = SECTION_ORDER.map((id) => {
    const r = rows[id].sort((a, b) => (rowTimestamp(a) < rowTimestamp(b) ? -1 : rowTimestamp(a) > rowTimestamp(b) ? 1 : 0));
    const ls = sectionLines(id);
    let subtotalNgn: string | null = null;
    let gainNgn: string | undefined;
    if (id === "income") subtotalNgn = full(sumOf(ls.map((l) => l.incomeNgn)));
    if (id === "disposals") subtotalNgn = full(sumOf(ls.filter((l) => l.kind === "disposal").map((l) => l.gainNgn)));
    if (id === "gas") {
      subtotalNgn = full(sumOf(ls.map((l) => l.ngnValue)));
      gainNgn = full(sumOf(ls.map((l) => l.gainNgn)));
    }
    const meta = SECTION_META[id];
    return { id, title: meta.title, explanation: meta.explanation, rows: r, lineCount: ls.length, subtotalNgn, subtotalLabel: meta.subtotalLabel, ...(gainNgn !== undefined ? { gainNgn } : {}) };
  });
  return out;
}

/** Checks the section subtotals against the engine totals (exact decimal equality). */
export function reconcileSections(sections: LineSection[], totals: { totalVaIncomeNgn: string; netGainsNgn: string; gasFeesNgn: string }) {
  const s = (id: SectionId) => sections.find((x) => x.id === id)!;
  const income = dec(s("income").subtotalNgn!);
  const netGains = dec(s("disposals").subtotalNgn!).plus(dec(s("gas").gainNgn ?? "0"));
  const gas = dec(s("gas").subtotalNgn!);
  return {
    income: income.eq(dec(totals.totalVaIncomeNgn)),
    netGains: netGains.eq(dec(totals.netGainsNgn)),
    gas: gas.eq(dec(totals.gasFeesNgn)),
  };
}

/** "7.1 event 5 (D2: gas fee is a NEAR disposal; not deductible)" -> ref "7.1 event 5", decision "D2", note. */
export function splitRef(circularRef: string): { ref: string; decision: string | null; note: string | null } {
  const m = /^(.*?)\s*\((.+)\)\s*$/.exec(circularRef);
  if (!m || !m[1]) return { ref: circularRef, decision: null, note: null };
  const inner = m[2];
  const d = /^(D\d+)\s*:\s*(.+)$/.exec(inner);
  if (d) return { ref: m[1], decision: d[1], note: d[2] };
  const lead = /^(D\d+)$/.exec(m[1]);
  return { ref: m[1], decision: lead ? lead[1] : null, note: inner };
}
