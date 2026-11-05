"use client";

import { useEffect, useState } from "react";
import { linesCsv, summaryCsv } from "@/lib/report/csv";
import { reportFingerprint } from "@/lib/report/fingerprint";
import { fmtNgn, fmtPrice, fmtQty, fmtUsd } from "@/lib/report/format";
import { privacyProofText } from "@/lib/report/privacy";
import type { ReportData } from "@/lib/tax/ng/report";

/** Same browser-only storage the questions page writes. */
interface Saved {
  ownText?: string;
  groups?: Record<string, unknown>;
  otherIncomeNgn?: string;
}

/** Personal fields for the PDF only: stored in this browser, never sent to the server. */
interface Personal {
  name: string;
  tin: string;
  state: string;
}

const cell = { border: "1px solid #ddd", padding: "3px 5px", textAlign: "left", verticalAlign: "top" } as const;
const num = { ...cell, textAlign: "right", fontFamily: "ui-monospace, monospace", fontSize: 12 } as const;
const short = (v: string | null | undefined, n = 10) => (v ? (v.length > n ? `${v.slice(0, n)}…` : v) : "—");
const personalKey = (account: string) => `uwii:personal:${account}`;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ReportView({ account }: { account: string }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answered, setAnswered] = useState<number | null>(null);
  const [ownAccounts, setOwnAccounts] = useState<string[]>([]);
  const [personal, setPersonal] = useState<Personal>({ name: "", tin: "", state: "" });
  const [personalLoaded, setPersonalLoaded] = useState(false);
  const [browserFp, setBrowserFp] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    // Hydrate personal fields from this browser after mount (localStorage is unavailable during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPersonal(readJson<Personal>(personalKey(account), { name: "", tin: "", state: "" }));
    setPersonalLoaded(true);
  }, [account]);

  useEffect(() => {
    if (!personalLoaded) return;
    try {
      window.localStorage.setItem(personalKey(account), JSON.stringify(personal));
    } catch {
      // storage unavailable; fields still work for this session
    }
  }, [account, personal, personalLoaded]);

  useEffect(() => {
    const saved = readJson<Saved>(`uwii:answers:${account}`, {});
    const groups = saved.groups ?? {};
    const own = (saved.ownText ?? "").split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    let cancelled = false;
    fetch("/api/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account, ownAccounts: own, answers: { groups }, profile: { otherIncomeNgn: (saved.otherIncomeNgn ?? "").trim() } }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        const report = json as ReportData;
        const fp = await reportFingerprint(report);
        if (!cancelled) {
          setAnswered(Object.keys(groups).length);
          setOwnAccounts(own);
          setData(report);
          setBrowserFp(fp);
        }
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [account]);

  async function downloadPdf() {
    if (!data) return;
    setPdfBusy(true);
    try {
      const { buildWorksheetPdf } = await import("@/lib/report/pdf");
      const bytes = await buildWorksheetPdf(data, { ...personal, ownAccounts });
      download(`uwii-${data.account}-${data.year}-worksheet.pdf`, bytes as BlobPart, "application/pdf");
    } catch (e) {
      setError(`PDF failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPdfBusy(false);
    }
  }

  if (error) return <p style={{ color: "#b00020" }}>Error: {error}</p>;
  if (!data) return <p>Computing (prices, NFEM rates, FIFO)…</p>;
  const t = data.totals;
  const fpMatch = browserFp === data.fingerprint;

  return (
    <div>
      <p style={{ fontSize: 13, color: "#555" }}>
        Answers used from this browser: {answered} group(s) · resolved by you {data.questionSummary.resolvedByUser}, unresolved {data.questionSummary.unresolved} ·
        classification {data.origin.classification} · prices {data.origin.prices} · opening {data.origin.opening}
      </p>

      {data.status === "draft" ? (
        <section
          data-testid="draft-banner"
          role="alert"
          style={{ border: "2px solid #b00020", background: "#fdecee", padding: "10px 14px", marginBottom: 16, borderRadius: 4 }}
        >
          <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#b00020" }}>
            {data.blockingQuestions > 0 ? (
              <>
                Draft: answer {data.blockingQuestions} question{data.blockingQuestions === 1 ? "" : "s"} to finalise.{" "}
                <a href={`/dev/questions?account=${encodeURIComponent(data.account)}`}>Go to questions →</a>
              </>
            ) : (
              <>Draft: not for filing until the issues below are resolved.</>
            )}
          </p>
          <ul style={{ margin: "6px 0 0", fontSize: 13 }}>
            {data.draftReasons.map((r) => <li key={r.code}>{r.message}</li>)}
          </ul>
        </section>
      ) : (
        <p data-testid="final-badge" style={{ display: "inline-block", padding: "4px 10px", background: "#1a7f37", color: "#fff", borderRadius: 4, fontWeight: 600 }}>
          Final: every transaction is resolved
        </p>
      )}

      <section data-testid="exports" style={{ border: "1px solid #ccc", padding: 12, marginBottom: 16 }}>
        <p style={{ margin: "0 0 6px" }}>
          <strong>Report fingerprint (SHA-256):</strong>{" "}
          <code data-testid="fingerprint" style={{ fontSize: 12 }}>{data.fingerprint}</code>{" "}
          <span data-testid="fingerprint-check" style={{ color: fpMatch ? "#1a7f37" : "#b00020", fontSize: 12 }}>
            {fpMatch ? "✓ recomputed in this browser: match" : `✗ browser recomputation differs: ${browserFp}`}
          </span>
        </p>
        <p style={{ fontSize: 12, color: "#555", margin: "0 0 8px" }}>
          Optional, printed on the PDF only. Stored in this browser; never sent to the server and not part of the fingerprint.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
          <label>Taxpayer name <input data-testid="taxpayer-name" value={personal.name} onChange={(e) => setPersonal((p) => ({ ...p, name: e.target.value }))} /></label>
          <label>TIN <input data-testid="taxpayer-tin" value={personal.tin} onChange={(e) => setPersonal((p) => ({ ...p, tin: e.target.value }))} /></label>
          <label>State of residence <input data-testid="taxpayer-state" value={personal.state} onChange={(e) => setPersonal((p) => ({ ...p, state: e.target.value }))} /></label>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button data-testid="download-pdf" onClick={downloadPdf} disabled={pdfBusy}>{pdfBusy ? "Building PDF…" : "Download PDF"}</button>
          <button data-testid="download-csv-lines" onClick={() => download(`uwii-${data.account}-${data.year}-lines.csv`, linesCsv(data), "text/csv;charset=utf-8")}>Download CSV (lines)</button>
          <button data-testid="download-csv-summary" onClick={() => download(`uwii-${data.account}-${data.year}-summary.csv`, summaryCsv(data), "text/csv;charset=utf-8")}>Download CSV (summary)</button>
        </div>
      </section>

      <section data-testid="totals" style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
        <table style={{ borderCollapse: "collapse" }}>
          <tbody>
            {[
              ["Total VA income (NGN)", t.totalVaIncomeNgn],
              ["Disposal gains (NGN)", t.disposalGainsNgn],
              ["Disposal losses (NGN)", t.disposalLossesNgn],
              ["Net gains (NGN)", t.netGainsNgn],
              ["Carry-forward loss (NGN)", data.carryForwardLossNgn],
              ["Chargeable VA (NGN)", t.chargeableVaNgn],
              ["Gas fees, shown separately (NGN)", t.gasFeesNgn],
            ].map(([k, v]) => (
              <tr key={k}><th style={cell}>{k}</th><td style={num}>{fmtNgn(v)}</td></tr>
            ))}
          </tbody>
        </table>
        <table data-testid="tax" style={{ borderCollapse: "collapse" }}>
          <tbody>
            <tr><th style={cell}>Other income (NGN)</th><td style={num}>{data.tax.otherIncomeNgn ? fmtNgn(data.tax.otherIncomeNgn) : "not provided"}</td></tr>
            <tr><th style={cell}>PIT with VA</th><td style={num}>{fmtNgn(data.tax.pitWithVaNgn)}</td></tr>
            <tr><th style={cell}>PIT without VA</th><td style={num}>{fmtNgn(data.tax.pitWithoutVaNgn)}</td></tr>
            <tr><th style={cell}>Tax attributable to VA (NGN)</th><td style={{ ...num, fontWeight: 700 }}>{fmtNgn(data.tax.taxAttributableToVaNgn)}</td></tr>
          </tbody>
        </table>
      </section>
      <ul style={{ fontSize: 13 }}>{data.tax.notes.map((n) => <li key={n}>{n}</li>)}</ul>

      <section data-testid="privacy-proof">
        <h2 style={{ fontSize: 16 }}>Privacy proof</h2>
        <p style={{ fontSize: 13 }}>{privacyProofText(data.privacyProof)}</p>
      </section>

      <section data-testid="warnings">
        <h2 style={{ fontSize: 16 }}>Warnings ({data.warnings.length})</h2>
        <ul style={{ fontSize: 13 }}>{data.warnings.map((w, i) => <li key={i}><code>{w.code}</code> {w.message}</li>)}</ul>
      </section>

      <section>
        <h2 style={{ fontSize: 16 }}>Lines ({data.lines.length})</h2>
        <table data-testid="lines" style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
          <thead>
            <tr>
              {["date", "label", "asset", "qty", "USD price (gran.)", "USD value", "cost USD", "gain USD", "CBN NFEM (formerly NAFEM) rate", "NGN value", "gain NGN", "circularRef", "method", "tx"].map((h) => (
                <th key={h} style={cell}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l, i) => (
              <tr key={i} style={l.includedInTotals ? undefined : { color: "#777" }} title={l.notes.join(" · ")}>
                <td style={{ ...cell, whiteSpace: "nowrap" }}>{l.date}</td>
                <td style={cell}>{l.label}</td>
                <td style={cell}>{l.asset}</td>
                <td style={num}>{short(fmtQty(l.qty), 16)}</td>
                <td style={num}>{l.usdPrice ? `${fmtPrice(l.usdPrice)} (${l.priceGranularity})` : l.priceStatus === "no_verifiable_price" ? "no verifiable price" : "—"}</td>
                <td style={num}>{fmtUsd(l.usdValue)}</td>
                <td style={num}>{fmtUsd(l.costUsd)}</td>
                <td style={num}>{fmtUsd(l.gainUsd)}</td>
                <td style={num}>{l.nafemRate ? `${l.nafemRate}${l.rateFallback ? ` (fallback ${l.rateDate})` : ""}` : "—"}</td>
                <td style={num}>{fmtNgn(l.ngnValue)}</td>
                <td style={num}>{fmtNgn(l.gainNgn)}</td>
                <td style={{ ...cell, fontSize: 11 }}>{l.circularRef}</td>
                <td style={cell}>{l.method}</td>
                <td style={{ ...cell, fontFamily: "ui-monospace, monospace" }}>
                  {l.txHash ? <a href={`https://nearblocks.io/txns/${l.txHash}`} target="_blank" rel="noreferrer">{short(l.txHash, 8)}</a> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ fontSize: 12, color: "#555" }}>
        <h2 style={{ fontSize: 14 }}>Decisions applied</h2>
        <ul>{data.decisionsApplied.map((d) => <li key={d.id}><strong>{d.id}</strong> {d.text}</li>)}</ul>
        <h2 style={{ fontSize: 14 }}>Data sources</h2>
        <ul>{data.dataSources.map((s) => <li key={s.name}><strong>{s.name}:</strong> {s.detail}{s.retrievedAt ? ` (retrieved ${s.retrievedAt})` : ""}</li>)}</ul>
      </section>
    </div>
  );
}
