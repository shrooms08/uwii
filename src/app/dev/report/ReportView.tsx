"use client";

import { useEffect, useState } from "react";
import type { ReportData } from "@/lib/tax/ng/report";

/** Same browser-only storage the questions page writes. */
interface Saved {
  ownText?: string;
  groups?: Record<string, unknown>;
  otherIncomeNgn?: string;
}

const cell = { border: "1px solid #ddd", padding: "3px 5px", textAlign: "left", verticalAlign: "top" } as const;
const num = { ...cell, textAlign: "right", fontFamily: "ui-monospace, monospace", fontSize: 12 } as const;

/** Presentation-only rounding to 2 dp (half-up) on decimal strings, without floating point. */
function r2(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const neg = v.startsWith("-");
  const [w, f = ""] = (neg ? v.slice(1) : v).split(".");
  const cents = BigInt(w + (f + "000").slice(0, 3));
  const rounded = (cents + BigInt(5)) / BigInt(10);
  const s = rounded.toString().padStart(3, "0");
  const out = `${s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${s.slice(-2)}`;
  return neg && rounded !== BigInt(0) ? `-${out}` : out;
}
const short = (v: string | null | undefined, n = 10) => (v ? (v.length > n ? `${v.slice(0, n)}…` : v) : "—");

export default function ReportView({ account }: { account: string }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answered, setAnswered] = useState<number | null>(null);

  useEffect(() => {
    let saved: Saved = {};
    try {
      saved = JSON.parse(window.localStorage.getItem(`uwii:answers:${account}`) ?? "{}") as Saved;
    } catch {
      saved = {};
    }
    const groups = saved.groups ?? {};
    const ownAccounts = (saved.ownText ?? "").split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    let cancelled = false;
    fetch("/api/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account, ownAccounts, answers: { groups }, profile: { otherIncomeNgn: (saved.otherIncomeNgn ?? "").trim() } }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!cancelled) {
          setAnswered(Object.keys(groups).length);
          setData(json as ReportData);
        }
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [account]);

  if (error) return <p style={{ color: "#b00020" }}>Error: {error}</p>;
  if (!data) return <p>Computing (prices, NFEM rates, FIFO)…</p>;
  const t = data.totals;

  return (
    <div>
      <p style={{ fontSize: 13, color: "#555" }}>
        Answers used from this browser: {answered} group(s) · resolved by you {data.questionSummary.resolvedByUser}, unresolved {data.questionSummary.unresolved} ·
        classification {data.origin.classification} · prices {data.origin.prices} · opening {data.origin.opening}
      </p>

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
              <tr key={k}><th style={cell}>{k}</th><td style={num}>{r2(v)}</td></tr>
            ))}
          </tbody>
        </table>
        <table data-testid="tax" style={{ borderCollapse: "collapse" }}>
          <tbody>
            <tr><th style={cell}>Other income (NGN)</th><td style={num}>{data.tax.otherIncomeNgn ? r2(data.tax.otherIncomeNgn) : "not provided"}</td></tr>
            <tr><th style={cell}>PIT with VA</th><td style={num}>{r2(data.tax.pitWithVaNgn)}</td></tr>
            <tr><th style={cell}>PIT without VA</th><td style={num}>{r2(data.tax.pitWithoutVaNgn)}</td></tr>
            <tr><th style={cell}>Tax attributable to VA (NGN)</th><td style={{ ...num, fontWeight: 700 }}>{r2(data.tax.taxAttributableToVaNgn)}</td></tr>
          </tbody>
        </table>
      </section>
      <ul style={{ fontSize: 13 }}>{data.tax.notes.map((n) => <li key={n}>{n}</li>)}</ul>

      <section data-testid="warnings">
        <h2 style={{ fontSize: 16 }}>Warnings ({data.warnings.length})</h2>
        <ul style={{ fontSize: 13 }}>{data.warnings.map((w, i) => <li key={i}><code>{w.code}</code> {w.message}</li>)}</ul>
      </section>

      <section>
        <h2 style={{ fontSize: 16 }}>Lines ({data.lines.length})</h2>
        <table data-testid="lines" style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
          <thead>
            <tr>
              {["date", "label", "asset", "qty", "USD price (gran.)", "USD value", "cost USD", "gain USD", "NFEM rate", "NGN value", "gain NGN", "circularRef", "method", "tx"].map((h) => (
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
                <td style={num}>{short(l.qty, 14)}</td>
                <td style={num}>{l.usdPrice ? `${short(l.usdPrice, 9)} (${l.priceGranularity})` : l.priceStatus === "no_verifiable_price" ? "no verifiable price" : "—"}</td>
                <td style={num}>{r2(l.usdValue)}</td>
                <td style={num}>{r2(l.costUsd)}</td>
                <td style={num}>{r2(l.gainUsd)}</td>
                <td style={num}>{l.nafemRate ? `${l.nafemRate}${l.rateFallback ? ` (fallback ${l.rateDate})` : ""}` : "—"}</td>
                <td style={num}>{r2(l.ngnValue)}</td>
                <td style={num}>{r2(l.gainNgn)}</td>
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
        <ul>{data.dataSources.map((s) => <li key={s.name}><strong>{s.name}:</strong> {s.detail}</li>)}</ul>
      </section>
    </div>
  );
}
