import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { InvalidAccount, readAccount, type SearchParams } from "@/components/account-param";
import ExportClient from "./ExportClient";

export const metadata: Metadata = { title: "Export your worksheet · Uwii" };

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
