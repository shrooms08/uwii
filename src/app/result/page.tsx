import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { InvalidAccount, readAccount, type SearchParams } from "@/components/account-param";
import ResultClient from "./ResultClient";

export const metadata: Metadata = { title: "Your 2026 crypto tax · Uwii" };

async function Result({ searchParams }: { searchParams: SearchParams }) {
  const account = readAccount(await searchParams);
  if (!account.ok) return <InvalidAccount reason={account.reason} />;
  return (
    <AppShell step="result" account={account.id}>
      <ResultClient key={account.id} account={account.id} />
    </AppShell>
  );
}

export default function ResultPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AppShell>{null}</AppShell>}>
      <Result searchParams={searchParams} />
    </Suspense>
  );
}
