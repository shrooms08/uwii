import assert from "node:assert/strict";
import { test } from "node:test";
import { LINE_COLUMNS, csvField, linesCsv, summaryCsv } from "./csv";
import { canonicalReportJson, reportFingerprint } from "./fingerprint";
import type { ReportLine } from "../tax/ng/engine";

/** Minimal RFC 4180 reader used to check the exports round-trip. */
function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r" && s[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function shuffleKeys<T>(v: T): T {
  if (Array.isArray(v)) return v.map(shuffleKeys) as T;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).reverse();
    return Object.fromEntries(entries.map(([k, x]) => [k, shuffleKeys(x)])) as T;
  }
  return v;
}

const sample = {
  account: "alice.near",
  year: 2026,
  generatedAt: "2026-11-05T10:00:00.000Z",
  origin: { classification: "fixture", prices: "live", opening: "fixture" },
  totals: { totalVaIncomeNgn: "1234.5678901234567890", netGainsNgn: "-2.5" },
  tax: { otherIncomeNgn: "4800000", basis: "marginal_over_other_income", taxAttributableToVaNgn: "185.185" },
  lines: [{ date: "2026-03-01", qty: "0.000000000000000000000001", usdValue: "1.10" }],
  warnings: [{ code: "rate_fallback", message: "x" }],
};

test("fingerprint is deterministic: same data with a different key order gives the same hash", async () => {
  const a = await reportFingerprint(sample);
  const b = await reportFingerprint(shuffleKeys(sample));
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(canonicalReportJson(sample), canonicalReportJson(shuffleKeys(sample)));
  // Decimal strings are hashed as-is: "1.10" and "1.1" are different reports.
  const changed = structuredClone(sample);
  changed.lines[0].usdValue = "1.1";
  assert.notEqual(await reportFingerprint(changed), a);
  // Canonical form has sorted keys and no whitespace.
  assert.ok(canonicalReportJson({ b: 1, a: { d: "2", c: [3, "4"] } }) === '{"a":{"c":[3,"4"],"d":"2"},"b":1}');
});

test("fingerprint excludes personal fields and delivery metadata", async () => {
  const base = await reportFingerprint(sample);
  const withPersonal = { ...structuredClone(sample), personal: { name: "Ada Example", tin: "12345678-0001", state: "Lagos" } };
  const otherPersonal = { ...structuredClone(sample), personal: { name: "Someone Else", tin: "99999999-0002", state: "Abuja" } };
  assert.equal(await reportFingerprint(withPersonal), base);
  assert.equal(await reportFingerprint(otherPersonal), base);
  const otherIncome = structuredClone(sample);
  otherIncome.tax.otherIncomeNgn = "12000000";
  assert.equal(await reportFingerprint(otherIncome), base, "other-income input excluded");
  const redelivered = { ...structuredClone(sample), generatedAt: "2027-01-01T00:00:00.000Z", origin: { classification: "cache" }, fingerprint: "old" };
  assert.equal(await reportFingerprint(redelivered), base, "generatedAt/origin/fingerprint excluded");
  const computed = structuredClone(sample);
  computed.tax.taxAttributableToVaNgn = "185.186";
  assert.notEqual(await reportFingerprint(computed), base, "computed tax is covered");
});

const line = (p: Partial<ReportLine>): ReportLine => ({
  date: "2026-10-08",
  timestamp: "2026-10-08T17:54:51.000Z",
  recordId: "r1",
  txHash: "FcmgcGUcF98xt9hc43i1VF9QysWV1ype6s3riA6uMV6e",
  label: "disposal_swap",
  kind: "disposal",
  asset: "wNEAR",
  assetKey: "NEAR",
  qty: "20",
  usdPrice: "4.405311354355813",
  priceGranularity: "hourly",
  priceSource: "CoinGecko",
  priceMethod: "m",
  priceStatus: "ok",
  usdValue: "88.10622708711626",
  costUsd: "67.43",
  gainUsd: "20.67",
  nafemRate: "1333.5500",
  rateDate: "2026-10-08",
  rateFallback: false,
  ngnValue: "117494.1095384",
  circularRef: "9.1.2; 9.3.2; Illustration 3",
  method: "rule",
  includedInTotals: true,
  notes: [],
  ...p,
});

test("CSV escapes commas, quotes and newlines; one row per line plus a header", () => {
  assert.equal(csvField('say "hi", ok'), '"say ""hi"", ok"');
  assert.equal(csvField("a\nb"), '"a\nb"');
  assert.equal(csvField(" lead"), '" lead"');
  assert.equal(csvField("plain"), "plain");
  const lines = [
    line({}),
    line({ label: 'weird "label", with comma', circularRef: "7.1 events 3-4; 9.1.2", ngnValue: "762.654321", rateFallback: true }),
    line({ usdPrice: null, priceGranularity: null, usdValue: null, costUsd: undefined, gainUsd: undefined, ngnValue: null, txHash: "" }),
  ];
  const csv = linesCsv({ lines });
  assert.ok(csv.startsWith("﻿"), "UTF-8 BOM for spreadsheets");
  const rows = parseCsv(csv);
  assert.equal(rows.length, lines.length + 1);
  assert.deepEqual(rows[0], [...LINE_COLUMNS]);
  assert.ok(rows.every((r) => r.length === LINE_COLUMNS.length), "every row has every column");
  assert.equal(rows[2][1], 'weird "label", with comma', "round-trips through a CSV reader");
  assert.equal(rows[1][LINE_COLUMNS.indexOf("ngnValue")], "117494.11", "NGN rounded to 2 dp");
  assert.equal(rows[1][LINE_COLUMNS.indexOf("usdValue")], "88.10622708711626", "USD unrounded");
  assert.equal(rows[2][LINE_COLUMNS.indexOf("rateFallback")], "true");
  assert.equal(rows[3][LINE_COLUMNS.indexOf("usdPrice")], "");
});

test("CSV exports of the demo report (committed fixtures): line count matches and summary parses", async () => {
  const { buildReport } = await import("../tax/ng/report");
  const { report } = await buildReport({ account: "rybergh44.near" });
  assert.match(report.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(await reportFingerprint(report), report.fingerprint, "fingerprint recomputes identically");
  const rows = parseCsv(linesCsv(report));
  assert.equal(rows.length - 1, report.lines.length);
  const summary = parseCsv(summaryCsv(report));
  assert.equal(summary[0].join(","), "metric,value,note");
  assert.ok(summary.some((r) => r[0] === "fingerprint" && r[1] === report.fingerprint));
});
