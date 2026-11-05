import { Suspense } from "react";
import { isValidAccountId } from "@/lib/history/fetch";
import ReportView from "./ReportView";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function Report({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.account) ? sp.account[0] : sp.account;
  const account = raw?.trim().toLowerCase();
  if (!account) return <p>Add <code>?account=&lt;id&gt;</code>, e.g. <code>/dev/report?account=rybergh44.near</code>.</p>;
  if (!isValidAccountId(account)) return <p style={{ color: "#b00020" }}>Invalid NEAR account id: {account}</p>;
  return <ReportView account={account} />;
}

export default function ReportPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 1400, margin: "0 auto", padding: 24, lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 22 }}>Uwii · Phase 5 tax report (NRS 2026/21)</h1>
      <p style={{ fontSize: 13, color: "#555" }}>Uses the answers saved in this browser by /dev/questions. Figures are rounded to 2 dp for display only.</p>
      <Suspense fallback={<p>Loading…</p>}>
        <Report searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
