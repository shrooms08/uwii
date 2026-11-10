/**
 * CBN NFEM (Nigerian Foreign Exchange Market; formerly NAFEM) closing USD/NGN rate (D8).
 *
 * Source: the Central Bank of Nigeria's own JSON feed behind the "NFEM Rate (₦/US$)" table on
 * https://www.cbn.gov.ng/rates/ExchRateByCurrency.html -> https://www.cbn.gov.ng/api/GetAllNFEM_Rates
 * (field `closingrate`, one row per published trading day).
 *
 * Lookup: the exact date, else the most recent prior published date (flagged `rate_fallback`).
 * Rates are never interpolated. Dates are UTC calendar dates (the history's timestamps are UTC).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { dec } from "../money";
import { NafemTable } from "./nafem-table";

export { NafemTable, type FxQuote, type NafemJson } from "./nafem-table";

/** Load the committed CSV (statically scoped path so bundlers trace only data/fx). */
export async function loadNafemTable(): Promise<NafemTable> {
  return NafemTable.parse(await readFile(path.join(process.cwd(), "data", "fx", "cbn-nafem-usdngn.csv"), "utf8"));
}

export const CBN_NFEM_API_URL = "https://www.cbn.gov.ng/api/GetAllNFEM_Rates";
export const CBN_NFEM_PAGE_URL = "https://www.cbn.gov.ng/rates/ExchRateByCurrency.html";
export const NAFEM_CSV = path.join(process.cwd(), "data", "fx", "cbn-nafem-usdngn.csv");

export interface NafemRow {
  date: string; // YYYY-MM-DD
  closingRate: string; // NGN per USD, exact decimal string as published
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** CBN publishes dates like "October-13-2026". */
export function parseCbnDate(s: string): string {
  const m = /^([A-Za-z]+)-(\d{1,2})-(\d{4})$/.exec(s.trim());
  const month = m ? MONTHS.findIndex((x) => x.toLowerCase() === m[1].toLowerCase()) : -1;
  if (!m || month < 0) throw new Error(`Unrecognised CBN date "${s}"`);
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

export async function downloadNafemRates(): Promise<NafemRow[]> {
  const res = await fetch(CBN_NFEM_API_URL, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; uwii-fx/1.0)" },
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`CBN NFEM download failed: HTTP ${res.status}`);
  const raw = (await res.json()) as { ratedate?: unknown; closingrate?: unknown }[];
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("CBN NFEM response is empty or not an array");
  const byDate = new Map<string, string>();
  for (const r of raw) {
    if (typeof r.ratedate !== "string" || typeof r.closingrate !== "string" || !/^\d+(\.\d+)?$/.test(r.closingrate)) {
      throw new Error(`Unexpected CBN NFEM row: ${JSON.stringify(r).slice(0, 200)}`);
    }
    const date = parseCbnDate(r.ratedate);
    const prev = byDate.get(date);
    if (prev !== undefined && !dec(prev).eq(dec(r.closingrate))) {
      throw new Error(`CBN NFEM publishes two different closing rates for ${date}: ${prev} and ${r.closingrate}`);
    }
    byDate.set(date, r.closingrate);
  }
  return [...byDate.entries()].map(([date, closingRate]) => ({ date, closingRate })).sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function writeNafemCsv(rows: NafemRow[], meta: { sourceUrl: string; pageUrl: string; retrievedAt: string }): Promise<string> {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const lines = [
    `# CBN NFEM (formerly NAFEM) closing rate, NGN per 1 USD (field "closingrate").`,
    `# Source: ${meta.sourceUrl} (data behind "NFEM Rate (₦/US$)" on ${meta.pageUrl})`,
    `# Retrieved: ${meta.retrievedAt}`,
    `# One row per published trading day; no rows for weekends/holidays (lookup falls back to the prior published date).`,
    "date,closing_rate",
    ...rows.map((r) => `${r.date},${r.closingRate}`),
  ];
  const { assertWritable } = await import("../history/paths");
  assertWritable(NAFEM_CSV);
  await mkdir(path.dirname(NAFEM_CSV), { recursive: true });
  await writeFile(NAFEM_CSV, lines.join("\n") + "\n");
  return NAFEM_CSV;
}

