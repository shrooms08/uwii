import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { InvalidAccount, readAccount, type SearchParams } from "@/components/account-param";
import QuestionsClient from "./QuestionsClient";

export const metadata: Metadata = { title: "Questions · Uwii" };

async function Questions({ searchParams }: { searchParams: SearchParams }) {
  const account = readAccount(await searchParams);
  if (!account.ok) return <InvalidAccount reason={account.reason} />;
  return (
    <AppShell step="questions" account={account.id}>
      <QuestionsClient key={account.id} account={account.id} />
    </AppShell>
  );
}

export default function QuestionsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AppShell>{null}</AppShell>}>
      <Questions searchParams={searchParams} />
    </Suspense>
  );
}
