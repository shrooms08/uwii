import { Suspense } from "react";
import { isValidAccountId } from "@/lib/history/fetch";
import QuestionFlow from "./QuestionFlow";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function Flow({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.account) ? sp.account[0] : sp.account;
  const account = raw?.trim().toLowerCase();
  if (!account) return <p>Add <code>?account=&lt;id&gt;</code>, e.g. <code>/dev/questions?account=rybergh44.near</code>.</p>;
  if (!isValidAccountId(account)) return <p style={{ color: "#b00020" }}>Invalid NEAR account id: {account}</p>;
  return <QuestionFlow account={account} />;
}

export default function QuestionsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 1100, margin: "0 auto", padding: 24, lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 22 }}>Uwii · Phase 4 questions</h1>
      <p style={{ fontSize: 13, color: "#555" }}>Your answers stay in this browser and are sent only with each check; Uwii does not store them.</p>
      <Suspense fallback={<p>Loading…</p>}>
        <Flow searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
