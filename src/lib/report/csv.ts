/**
 * CSV exports (UTF-8 with BOM so spreadsheets detect the encoding; RFC 4180 quoting; CRLF rows).
 * Decimal strings are written unrounded, except NGN amounts which are rounded to 2 dp.
 */
import { dec, money2 } from "../money";
import type { ReportData } from "../tax/ng/report";

export const LINE_COLUMNS = [
  "date",
  "label",
  "circularRef",
  "asset",
  "quantity",
  "usdPrice",
  "priceGranularity",
  "usdValue",
  "costUsd",
  "gainUsd",
  "nfemRate",
  "rateFallback",
  "ngnValue",
  "method",
  "txHash",
] as const;

const BOM = "﻿";

/** RFC 4180: quote fields containing comma, quote, CR/LF or leading/trailing spaces; double inner quotes. */
export function csvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const row = (fields: (string | number | boolean | null | undefined)[]) => fields.map(csvField).join(",");
const ngn2 = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? "" : money2(dec(v)));

export function linesCsv(report: Pick<ReportData, "lines">): string {
  const out = [row([...LINE_COLUMNS])];
  for (const l of report.lines) {
    out.push(
      row([
        l.date,
        l.label,
        l.circularRef,
        l.asset,
        l.qty,
        l.usdPrice,
        l.priceGranularity,
        l.usdValue,
        l.costUsd ?? "",
        l.gainUsd ?? "",
        l.nafemRate,
        l.rateFallback,
        ngn2(l.ngnValue),
        l.method,
        l.txHash,
      ]),
    );
  }
  return BOM + out.join("\r\n") + "\r\n";
}

export function summaryCsv(report: ReportData): string {
  const t = report.totals;
  const rows: [string, string, string][] = [
    ["account", report.account, ""],
    ["yearOfAssessment", String(report.year), ""],
    ["fingerprint", report.fingerprint ?? "", "SHA-256 of canonical report JSON (personal fields excluded)"],
    ["totalVaIncomeNgn", ngn2(t.totalVaIncomeNgn), "NGN, 2 dp"],
    ["totalVaIncomeUsd", t.totalVaIncomeUsd, "USD, unrounded"],
    ["disposalGainsNgn", ngn2(t.disposalGainsNgn), "NGN, 2 dp"],
    ["disposalLossesNgn", ngn2(t.disposalLossesNgn), "NGN, 2 dp"],
    ["netDisposalGainsNgn", ngn2(t.netGainsNgn), "NGN, 2 dp (9.4)"],
    ["carryForwardLossNgn", ngn2(report.carryForwardLossNgn), "NGN, 2 dp; not offset against income"],
    ["chargeableVaNgn", ngn2(t.chargeableVaNgn), "income + max(net gains, 0)"],
    ["gasFeesNgn", ngn2(t.gasFeesNgn), "D2: not deductible; shown separately"],
    ["gasFeesUsd", t.gasFeesUsd, "USD, unrounded"],
    ["taxBasis", report.tax.basis, report.tax.basis === "standalone" ? "assumes no other income" : "marginal over other income"],
    ["pitWithVaNgn", ngn2(report.tax.pitWithVaNgn), "NGN, 2 dp (D6 bands)"],
    ["pitWithoutVaNgn", ngn2(report.tax.pitWithoutVaNgn), "NGN, 2 dp"],
    ["taxAttributableToVaNgn", ngn2(report.tax.taxAttributableToVaNgn), "NGN, 2 dp"],
    ["linesIncludedInTotals", String(t.linesIncluded), ""],
    ["linesExcluded", String(t.linesExcluded), ""],
    ["warnings", String(report.warnings.length), ""],
  ];
  return BOM + [row(["metric", "value", "note"]), ...rows.map((r) => row(r))].join("\r\n") + "\r\n";
}
