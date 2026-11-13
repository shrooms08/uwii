/**
 * The landing page's report preview: figures and a few lines from the committed demo result
 * (rybergh44.near, committed classification, illustrative answers). Computed once at build time with the
 * same code as the Result page; no AI call and no user's data.
 */
import { cacheLife } from "next/cache";
import { shortLabel } from "../report/explain";
import { fmtDate, fmtNgn } from "../report/format";
import { lineSections, splitRef } from "../report/sections";
import { buildReport } from "../tax/ng/report";
import { DEMO_ACCOUNT, ILLUSTRATIVE_ANSWERS } from "./illustrative-answers";

export interface DemoPreview {
  final: boolean;
  tax: string;
  totalVaIncome: string;
  netGains: string;
  chargeable: string;
  lines: number;
  linesWithRef: number;
  rows: { date: string; label: string; ngn: string; ref: string }[];
}

export async function demoPreview(): Promise<DemoPreview> {
  "use cache";
  cacheLife("max");
  const { report } = await buildReport({
    account: DEMO_ACCOUNT,
    classificationSource: "fixture",
    answers: { groups: ILLUSTRATIVE_ANSWERS.groups },
    profile: { otherIncomeNgn: ILLUSTRATIVE_ANSWERS.otherIncomeNgn },
  });
  const sections = lineSections(report);
  const rows: DemoPreview["rows"] = [];
  // One staking reward, one swap and one naira sale: income at its value, disposals at their gain.
  const income = sections.find((s) => s.id === "income")?.rows.find((r) => r.type === "line");
  if (income?.type === "line") {
    const l = income.line;
    rows.push({ date: fmtDate(l.timestamp), label: shortLabel(l.label), ngn: fmtNgn(l.incomeNgn ?? l.ngnValue), ref: splitRef(l.circularRef).ref });
  }
  const disposals = sections.find((s) => s.id === "disposals")?.rows ?? [];
  const swap = disposals.find((r) => r.type === "swap");
  if (swap?.type === "swap") rows.push({ date: fmtDate(swap.timestamp), label: "Swap, gain", ngn: fmtNgn(swap.gainNgn), ref: splitRef(swap.gives[0].circularRef).ref });
  const sale = disposals.find((r) => r.type === "line" && r.line.label === "disposal_sale_fiat");
  if (sale?.type === "line") {
    const l = sale.line;
    rows.push({ date: fmtDate(l.timestamp), label: `${shortLabel(l.label)}, gain`, ngn: fmtNgn(l.gainNgn), ref: splitRef(l.circularRef).ref });
  }
  return {
    final: report.status === "final",
    tax: fmtNgn(report.tax.taxAttributableToVaNgn),
    totalVaIncome: fmtNgn(report.totals.totalVaIncomeNgn),
    netGains: fmtNgn(report.totals.netGainsNgn),
    chargeable: fmtNgn(report.totals.chargeableVaNgn),
    lines: report.lines.length,
    linesWithRef: report.lines.filter((l) => l.circularRef.trim() !== "").length,
    rows,
  };
}
