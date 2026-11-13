import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site/metadata";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { InvalidAccount, readAccount, type SearchParams } from "@/components/account-param";
import ExportClient from "./ExportClient";

export const metadata: Metadata = pageMetadata("Get your crypto tax report · Uwii", "Download the tax computation worksheet (PDF and CSV), anchor its fingerprint on NEAR testnet, and see what to do next.", "/export");

async function Export({ searchParams }: { searchParams: SearchParams }) {
  const account = readAccount(await searchParams);
  if (!account.ok) return <InvalidAccount reason={account.reason} />;
  return (
    <AppShell step="export" account={account.id}>
      <ExportClient key={account.id} account={account.id} />
    </AppShell>
  );
}

export default function ExportPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AppShell>{null}</AppShell>}>
      <Export searchParams={searchParams} />
    </Suspense>
  );
}
