import { Suspense } from "react";
import { isValidAccountId } from "@/lib/history/fetch";
import { getClassification } from "@/lib/tax/ng/cache";
import { isAiEvidence } from "@/lib/tax/ng/types";

export const maxDuration = 300;

const DEFAULT_FROM = "2026-01-01";
const DEFAULT_TO = "2026-12-31";
const cell = { border: "1px solid #ddd", padding: "4px 6px", textAlign: "left", verticalAlign: "top" } as const;
const mono = { fontFamily: "ui-monospace, monospace", fontSize: 12 } as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Classified({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const account = one(sp.account)?.trim().toLowerCase();
  const from = one(sp.from) ?? DEFAULT_FROM;
  const to = one(sp.to) ?? DEFAULT_TO;
  const own = (one(sp.own) ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const live = one(sp.live) === "1";

  if (!account) return <p>Add <code>?account=&lt;id&gt;&amp;own=&lt;comma-separated own accounts&gt;</code>, e.g. <code>/dev/classify?account=rybergh44.near</code>.</p>;
  if (!isValidAccountId(account)) return <p style={{ color: "#b00020" }}>Invalid NEAR account id: {account}</p>;
  const badOwn = own.filter((a) => !isValidAccountId(a));
  if (badOwn.length) return <p style={{ color: "#b00020" }}>Invalid own account id(s): {badOwn.join(", ")}</p>;

  let data;
  try {
    data = await getClassification(account, from, to, { ownAccounts: own, live });
  } catch (e) {
    return <p style={{ color: "#b00020" }}>Classification failed: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const { run, origin } = data;
  const m = run.metrics;
  const labelCounts = Object.entries(
    run.records.reduce<Record<string, number>>((acc, r) => ((acc[r.label] = (acc[r.label] ?? 0) + 1), acc), {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <>
      {origin === "fixture" && (
        <p data-testid="demo-label" style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, background: "#fff4ce", border: "1px solid #e0c46c", fontSize: 13 }}>
          Demo dataset (classified {run.classifiedAt.slice(0, 10)})
        </p>
      )}
      <section>
        <p>
          <strong>Account:</strong> <code>{run.accountId}</code> · <strong>Range:</strong> {run.from} → {run.to} · <strong>Own accounts:</strong>{" "}
          {run.ownAccounts.length ? run.ownAccounts.join(", ") : "none declared"}
          <br />
          <strong>Model:</strong> {run.model ?? "—"} · {origin === "fixture" ? "demo fixture" : origin === "cache" ? "cached" : "classified live"} {run.classifiedAt}
        </p>
        <table data-testid="metrics" style={{ borderCollapse: "collapse" }}>
          <tbody>
            {[
              ["Total", m.total],
              ["Rule", `${m.rule} (${m.pctRule})`],
              ["AI", `${m.ai} (${m.pctAi})`],
              ["needsQuestion", m.needsQuestion],
              ["AI responses verified", `${m.aiResponsesVerified}/${m.aiResponses}`],
              ["Attestation reports verified", m.attestationVerified ? "yes" : "no"],
            ].map(([k, v]) => (
              <tr key={String(k)}><th style={cell}>{k}</th><td style={cell}>{v}</td></tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: "#555" }}>Attestation: {run.attestation.details}</p>
        <p style={{ fontSize: 13 }}>
          Labels: {labelCounts.map(([l, c]) => `${l} ${c}`).join(" · ")}
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: 16 }}>Classified transactions</h2>
        <table data-testid="classified-table" style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
          <thead>
            <tr>
              {["date (UTC)", "kind", "asset", "amount", "label", "assetCategory", "method", "confidence", "circularRef", "needsQuestion", "reason"].map((h) => (
                <th key={h} style={cell}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {run.records.map((r) => (
              <tr key={r.id} style={r.needsQuestion ? { background: "#fff8e1" } : undefined}>
                <td style={{ ...cell, whiteSpace: "nowrap" }}>{r.timestamp.replace("T", " ").slice(0, 19)}</td>
                <td style={cell}>{r.kind} ({r.direction})</td>
                <td style={cell}>{r.asset.symbol}</td>
                <td style={{ ...cell, ...mono, textAlign: "right" }}>{r.amount}</td>
                <td style={{ ...cell, ...mono }}>{r.label}{r.swapRole ? ` [${r.swapRole}]` : ""}</td>
                <td style={cell}>{r.assetCategory}</td>
                <td style={cell}>{r.method}{isAiEvidence(r.evidence) ? (r.evidence.signatureVerified ? " ✓sig" : " ✗sig") : ""}</td>
                <td style={cell}>{r.confidence.toFixed(2)}</td>
                <td style={{ ...cell, fontSize: 12 }}>{r.circularRef}</td>
                <td style={cell}>{r.needsQuestion ? "yes" : "no"}</td>
                <td style={{ ...cell, fontSize: 12, maxWidth: 380 }}>{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export default function ClassifyPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 1300, margin: "0 auto", padding: 24, lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 22 }}>Uwii · Phase 3 tax classification (NRS 2026/21)</h1>
      <Suspense fallback={<p>Classifying (rules first, then attested private AI)…</p>}>
        <Classified searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
