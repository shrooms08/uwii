import { Suspense } from "react";
import { getHistory } from "@/lib/history/cache";
import { formatUnits } from "@/lib/history/amount";
import { isValidAccountId } from "@/lib/history/fetch";
import { assetKey, countsByKind, stakingRewardsByPool, summarizeByAsset, totalFees } from "@/lib/history/summary";

export const maxDuration = 300;

const DEFAULT_FROM = "2026-01-01";
const DEFAULT_TO = "2026-12-31";
const EXPLORER_TX = "https://nearblocks.io/txns/";

const cell = { border: "1px solid #ddd", padding: "4px 6px", textAlign: "left", verticalAlign: "top" } as const;
const mono = { fontFamily: "ui-monospace, monospace", fontSize: 12 } as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function History({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const account = one(sp.account)?.trim().toLowerCase();
  const from = one(sp.from) ?? DEFAULT_FROM;
  const to = one(sp.to) ?? DEFAULT_TO;
  const live = one(sp.live) === "1";

  if (!account) return <p>Add <code>?account=&lt;id&gt;</code> to the URL, e.g. <code>/dev/history?account=rybergh44.near</code>.</p>;
  if (!isValidAccountId(account)) return <p style={{ color: "#b00020" }}>Invalid NEAR account id: {account}</p>;

  let data;
  try {
    data = await getHistory(account, from, to, { live });
  } catch (e) {
    return <p style={{ color: "#b00020" }}>Failed to load history: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const { result, origin } = data;
  const records = result.records;
  const rewards = stakingRewardsByPool(records);
  const fees = totalFees(records);
  const staking = result.staking;

  return (
    <>
      <section>
        {origin === "fixture" && (
          <p
            data-testid="demo-label"
            style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, background: "#fff4ce", border: "1px solid #e0c46c", fontSize: 13 }}
          >
            Demo dataset (captured {result.fetchedAt.slice(0, 10)})
          </p>
        )}
        <p>
          <strong>Account:</strong> <code>{result.accountId}</code>
          <br />
          <strong>Range:</strong> {result.from} → {result.to} (UTC, inclusive)
          <br />
          <strong>Records:</strong> {records.length} · source {result.source} · {origin === "fixture" ? "demo fixture" : origin === "cache" ? "cached" : "fetched live"} {result.fetchedAt}
          <br />
          <strong>Fees paid:</strong> {fees.total} NEAR across {fees.count} signed transactions
          <br />
          <strong>Staking rewards:</strong> {rewards.total} NEAR · negative reward days (not emitted): {staking.negativeRewardDays}
        </p>
      </section>

      <section style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 16 }}>By kind</h2>
          <table style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr><th style={cell}>kind</th><th style={cell}>count</th><th style={cell}>failed</th></tr>
            </thead>
            <tbody>
              {countsByKind(records).map((k) => (
                <tr key={k.kind}><td style={cell}>{k.kind}</td><td style={cell}>{k.total}</td><td style={cell}>{k.failed}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h2 style={{ fontSize: 16 }}>By asset</h2>
          <table style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr><th style={cell}>asset</th><th style={cell}>count</th><th style={cell}>failed</th><th style={cell}>in (ok)</th><th style={cell}>out (ok)</th></tr>
            </thead>
            <tbody>
              {summarizeByAsset(records).map((a) => (
                <tr key={a.asset}>
                  <td style={cell}>{a.asset}</td><td style={cell}>{a.total}</td><td style={cell}>{a.failed}</td>
                  <td style={{ ...cell, ...mono }}>{a.in}</td><td style={{ ...cell, ...mono }}>{a.out}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 16 }}>Staking rewards by pool</h2>
        {staking.pools.length === 0 ? (
          <p>No staking pools.</p>
        ) : (
          <table style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["pool", "first interaction", "start balance", "end balance", "deposits", "withdrawals", "reward days", "rewards (NEAR)"].map((h) => (
                  <th key={h} style={cell}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staking.pools.map((p) => (
                <tr key={p.pool}>
                  <td style={{ ...cell, ...mono }}>{p.pool}</td>
                  <td style={cell}>{p.firstInteraction.slice(0, 10)}</td>
                  <td style={{ ...cell, ...mono }}>{p.start.date}: {formatUnits(BigInt(p.start.totalBalance), 24)}</td>
                  <td style={{ ...cell, ...mono }}>{p.end.date}: {formatUnits(BigInt(p.end.totalBalance), 24)}</td>
                  <td style={{ ...cell, ...mono }}>{p.deposits}</td>
                  <td style={{ ...cell, ...mono }}>{p.withdrawals}</td>
                  <td style={cell}>{p.rewardDays}</td>
                  <td style={{ ...cell, ...mono }}>{p.rewards}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: 12, color: "#555" }}>
          Snapshots: get_account_total_balance at the block closest to each UTC midnight (through {staking.lastCompleteBoundary ?? "n/a"}) via {staking.archivalRpc}.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: 16 }}>Transactions</h2>
        <table data-testid="history-table" style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
          <thead>
            <tr>
              {["date (UTC)", "kind", "dir", "asset", "amount", "counterparty", "method", "success", "fee (NEAR)", "tx hash"].map((h) => (
                <th key={h} style={cell}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} style={r.success ? undefined : { background: "#fde8e8" }}>
                <td style={{ ...cell, whiteSpace: "nowrap" }}>{r.timestamp.replace("T", " ").slice(0, 19)}</td>
                <td style={cell}>{r.kind}</td>
                <td style={cell}>{r.direction}</td>
                <td style={cell} title={assetKey(r)}>{r.asset.symbol}</td>
                <td style={{ ...cell, ...mono, textAlign: "right" }}>{r.amount}</td>
                <td style={{ ...cell, ...mono, maxWidth: 220, overflowWrap: "anywhere" }}>{r.counterparty ?? "—"}</td>
                <td style={{ ...cell, ...mono }}>{r.method ?? "—"}</td>
                <td style={cell}>{r.success ? "yes" : "no"}</td>
                <td style={{ ...cell, ...mono, textAlign: "right" }}>{r.fee ? r.fee.amount : "—"}</td>
                <td style={{ ...cell, ...mono }}>
                  {r.txHash ? <a href={`${EXPLORER_TX}${r.txHash}`} target="_blank" rel="noreferrer">{r.txHash.slice(0, 10)}…</a> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export default function HistoryPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 1200, margin: "0 auto", padding: 24, lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 22 }}>Uwii · Phase 2 account history</h1>
      <Suspense fallback={<p>Loading history (uncached accounts take a while on the NearBlocks free tier)…</p>}>
        <History searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
