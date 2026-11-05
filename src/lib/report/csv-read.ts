/**
 * Reads a Uwii CSV export on the verify page (browser-only, nothing uploaded). The fingerprint covers
 * the whole canonical report (lines, totals, tax, warnings, decisions, data sources, privacy proof);
 * neither CSV carries all of that, so neither can recompute it. The summary CSV states the
 * fingerprint, which can then be checked on-chain; the lines CSV has no fingerprint at all.
 */
import { LINE_COLUMNS } from "./csv";

export type UwiiCsv = { kind: "summary"; fingerprint: string | null } | { kind: "lines"; rows: number } | { kind: "unknown" };

/** RFC 4180 parser (quoted fields, doubled quotes, CRLF or LF). */
export function parseCsv(text: string): string[][] {
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
    } else if (c === "\n" || (c === "\r" && s[i + 1] === "\n")) {
      if (c === "\r") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function readUwiiCsv(text: string): UwiiCsv {
  const rows = parseCsv(text);
  const header = rows[0]?.map((h) => h.trim()) ?? [];
  if (header.join(",") === "metric,value,note") {
    const fp = rows.find((r) => r[0] === "fingerprint")?.[1]?.trim().toLowerCase() ?? null;
    return { kind: "summary", fingerprint: fp && /^[0-9a-f]{64}$/.test(fp) ? fp : null };
  }
  if (header.length === LINE_COLUMNS.length && header.every((h, i) => h === LINE_COLUMNS[i])) {
    return { kind: "lines", rows: rows.slice(1).filter((r) => r.some((c) => c !== "")).length };
  }
  return { kind: "unknown" };
}
