import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { InvalidAccount, readAccount, type SearchParams } from "@/components/account-param";
import ScanClient from "./ScanClient";

export const metadata: Metadata = { title: "Scanning privately · Uwii" };

async function Scan({ searchParams }: { searchParams: SearchParams }) {
  const account = readAccount(await searchParams);
  if (!account.ok) return <InvalidAccount reason={account.reason} />;
  return (
    <AppShell step="scan" account={account.id}>
      <ScanClient key={account.id} account={account.id} />
    </AppShell>
  );
}

export default function ScanPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AppShell>{null}</AppShell>}>
      <Scan searchParams={searchParams} />
    </Suspense>
  );
}
