import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site/metadata";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { InvalidAccount, readAccount, type SearchParams } from "@/components/account-param";
import ResultClient from "./ResultClient";

export const metadata: Metadata = pageMetadata("Your 2026 crypto tax · Uwii", "The tax attributable to your NEAR crypto for 2026, worked out line by line under NRS Circular 2026/21, with the privacy proof for the AI step.", "/result", {
  og: "/result/opengraph-image",
  twitter: "/result/twitter-image",
  alt: "Example uwii report: the cached demo result for rybergh44.near with illustrative answers.",
});

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
