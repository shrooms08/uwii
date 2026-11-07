import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site/metadata";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { InvalidAccount, readAccount, type SearchParams } from "@/components/account-param";
import ScanClient from "./ScanClient";

export const metadata: Metadata = pageMetadata("Scanning privately · Uwii", "Uwii reads the account history, applies the NRS rules, and sends only what the rules cannot label to an attested AI model.", "/scan");

async function Scan({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const account = readAccount(sp);
  if (!account.ok) return <InvalidAccount reason={account.reason} />;
  const cached = (Array.isArray(sp.cached) ? sp.cached[0] : sp.cached) === "1";
  return (
    <AppShell step="scan" account={account.id}>
      <ScanClient key={`${account.id}-${cached ? "cached" : "live"}`} account={account.id} cached={cached} />
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
